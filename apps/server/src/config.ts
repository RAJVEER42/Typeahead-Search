// Single source of truth for every tunable. Read from env once at boot and
// frozen, so nothing can reach into process.env at runtime. Each default is
// also the documented default in .env.example — the app runs with no .env.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

// config.ts lives at apps/server/src; the repo-root .env is three levels up.
const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, "../../../.env") });

const str = (k: string, d: string): string => process.env[k] ?? d;
const int = (k: string, d: number): number => {
  const v = process.env[k];
  return v === undefined ? d : Number.parseInt(v, 10);
};
const num = (k: string, d: number): number => {
  const v = process.env[k];
  return v === undefined ? d : Number.parseFloat(v);
};
// comma list, trimmed, blanks dropped — e.g. CACHE_NODES.
const list = (k: string, d: string): string[] =>
  str(k, d)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config = Object.freeze({
  server: {
    port: int("PORT", 8080),
    host: str("HOST", "0.0.0.0"),
  },
  pg: {
    host: str("PG_HOST", "localhost"),
    port: int("PG_PORT", 5433),
    user: str("PG_USER", "typeahead"),
    password: str("PG_PASSWORD", "typeahead"),
    database: str("PG_DB", "typeahead"),
  },
  // the cache shards. order does not matter — the ring hashes node ids.
  cacheNodes: list("CACHE_NODES", "localhost:7070,localhost:7071,localhost:7072"),
  cache: {
    vnodes: int("CACHE_VNODES", 160),
    l1Max: int("L1_MAX", 2000),
    l1TtlMs: int("L1_TTL_MS", 1500),
    ttlSuggestSec: int("TTL_SUGGEST", 45),
    ttlJitter: num("TTL_JITTER", 0.2),
  },
  buffer: {
    batchSize: int("BATCH_SIZE_N", 2000),
    flushIntervalMs: int("FLUSH_INTERVAL_MS", 1000),
    walKey: str("WAL_KEY", "wal:searches"),
  },
  ranking: {
    topK: int("TOP_K", 10),
    wPop: num("W_POP", 1),
    wRec: num("W_REC", 2),
    halfLifeSec: int("DECAY_HALFLIFE_SEC", 1800),
  },
  trending: {
    decayIntervalMs: int("TREND_DECAY_INTERVAL_MS", 30000),
  },
});

export type Config = typeof config;
