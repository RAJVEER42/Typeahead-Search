// The durable store. Postgres is the source of truth for query counts; it is
// never on the read path (the trie serves suggestions). It does two jobs:
// fast initial ingestion via COPY, and additive batch upserts from the write
// buffer. The upsert decays recency *in SQL* using last_searched, so two
// racing flushes add instead of clobbering, and recency survives a restart.

import pg from "pg";
import copyFrom from "pg-copy-streams";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { config } from "../config.js";
import { counters } from "./metrics.js";
import type { QueryRow } from "../types.js";

const LAMBDA = Math.LN2 / config.ranking.halfLifeSec;
const UPSERT_CHUNK = 1000; // rows per INSERT, under postgres' bind-param ceiling

// escape a value for COPY ... FROM STDIN text format.
const copyEscape = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");

export class Store {
  private pool: pg.Pool;

  constructor() {
    this.pool = new pg.Pool({
      host: config.pg.host,
      port: config.pg.port,
      user: config.pg.user,
      password: config.pg.password,
      database: config.pg.database,
      max: 10,
    });
  }

  async ready(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async initSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS queries (
        query         TEXT PRIMARY KEY,
        count         BIGINT NOT NULL DEFAULT 0,
        recent_score  DOUBLE PRECISION NOT NULL DEFAULT 0,
        last_searched TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  async truncate(): Promise<void> {
    await this.pool.query("TRUNCATE queries");
  }

  /**
   * Stream rows into postgres with COPY — the fast path for the dataset
   * loader. Assumes an empty table (the loader truncates + de-dupes first).
   */
  async bulkLoad(rows: Array<{ query: string; count: number }>): Promise<void> {
    const client = await this.pool.connect();
    try {
      const stream = client.query(copyFrom.from("COPY queries (query, count) FROM STDIN"));
      const source = Readable.from(
        (function* () {
          for (const r of rows) yield `${copyEscape(r.query)}\t${r.count}\n`;
        })(),
      );
      await pipeline(source, stream);
    } finally {
      client.release();
    }
  }

  /**
   * Additive upsert of one coalesced flush window. count grows; recent_score is
   * decayed to now() then bumped by the window's increment. last_searched is
   * reset so the next decay measures from here.
   */
  async batchUpsert(window: Map<string, number>): Promise<void> {
    const entries = [...window.entries()];
    for (let i = 0; i < entries.length; i += UPSERT_CHUNK) {
      const chunk = entries.slice(i, i + UPSERT_CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach(([query, inc], j) => {
        const b = j * 3;
        // count and recency take separate params so postgres doesn't try to
        // infer one shared type for a bigint and a double.
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, now())`);
        params.push(query, inc, inc);
      });
      await this.pool.query(
        `
        INSERT INTO queries (query, count, recent_score, last_searched)
        VALUES ${values.join(",")}
        ON CONFLICT (query) DO UPDATE SET
          count = queries.count + EXCLUDED.count,
          recent_score = queries.recent_score
            * exp(-${LAMBDA} * extract(epoch from (now() - queries.last_searched)))
            + EXCLUDED.recent_score,
          last_searched = now()
        `,
        params,
      );
      counters.dbWriteBatches++;
      counters.dbWrites += chunk.length;
    }
  }

  /** Every query, for building the trie at boot. Carries recent + ts so the
   * trie can decay recency forward to read time. */
  async loadAll(): Promise<QueryRow[]> {
    const { rows } = await this.pool.query(
      "SELECT query, count, recent_score, extract(epoch from last_searched) * 1000 AS ts FROM queries",
    );
    return rows.map((r) => ({
      query: r.query as string,
      count: Number(r.count),
      recent: Number(r.recent_score),
      ts: Number(r.ts),
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
