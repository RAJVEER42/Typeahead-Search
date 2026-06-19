// Write-behind batching. POST /search must not write to postgres per request —
// at search-engine volumes that is the bottleneck. Instead each search is
// appended to a durable redis list (a write-ahead log), and a drainer
// periodically pulls a window, coalesces duplicates, and applies it once to
// postgres + the trie + trending.
//
// Why a redis list and not an in-memory Map? Durability. An in-memory buffer is
// at-most-once: a crash loses the whole un-flushed window. The WAL survives a
// process restart, and the drainer processes-then-trims (at-least-once) — a
// crash mid-flush replays a window, double-counting a few searches rather than
// dropping them. Approximate popularity counts happily tolerate the rare double.

import type { Redis } from "ioredis";
import { config } from "../config.js";
import { counters } from "./metrics.js";
import type { CacheCluster } from "./cache.js";
import type { CompletionTrie } from "./trie.js";
import type { Store } from "./store.js";
import type { Trending } from "./trending.js";

/** Fold a raw batch of queries into { query -> count }. The batching win:
 * 50 searches for "iphone" become one row, not 50. */
export function coalesce(batch: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const q of batch) m.set(q, (m.get(q) ?? 0) + 1);
  return m;
}

export class WriteBuffer {
  private readonly key = config.buffer.walKey;
  private readonly batchSize = config.buffer.batchSize;
  private timer: NodeJS.Timeout | null = null;
  private draining = false; // guard: never two drains at once

  constructor(
    private readonly cache: CacheCluster,
    private readonly store: Store,
    private readonly trie: CompletionTrie,
    private readonly trending: Trending,
  ) {}

  // the WAL is one list routed to one shard, so order + drain are simple.
  private wal(): Redis {
    return this.cache.clientFor(this.key);
  }

  /**
   * Record a search. Normalizes, appends to the WAL, and kicks an immediate
   * drain if the list just crossed the batch size (flush-on-size). Returns
   * fast — the durable write is the RPUSH, the rest is async.
   */
  async record(raw: string): Promise<void> {
    const query = raw.toLowerCase().trim();
    if (!query) return;
    counters.searchesReceived++;
    try {
      const depth = await this.wal().rpush(this.key, query);
      if (depth >= this.batchSize) void this.drain();
    } catch {
      /* WAL node down: this search is lost. documented at-least-once edge. */
    }
  }

  async pending(): Promise<number> {
    try {
      return await this.wal().llen(this.key);
    } catch {
      return 0;
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.drain(), config.buffer.flushIntervalMs);
    this.timer.unref?.();
  }

  /** Stop the interval and drain whatever is left — called on shutdown. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.drain();
  }

  /**
   * Pull windows of up to batchSize and apply each once. Process-before-trim:
   * we only LTRIM after postgres has the window, so a crash replays rather
   * than drops.
   */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const wal = this.wal();
      for (;;) {
        const batch = await wal.lrange(this.key, 0, this.batchSize - 1);
        if (batch.length === 0) break;

        const window = coalesce(batch);
        await this.store.batchUpsert(window); // durable first
        this.trie.applyIncrements(window); // keep the live index in sync
        await this.trending.bumpMany(window); // feed the leaderboard

        await wal.ltrim(this.key, batch.length, -1); // drop what we processed
        if (batch.length < this.batchSize) break;
      }
    } catch {
      /* a transient flush error must not crash the process; the WAL still holds
         the un-trimmed window, so the next drain retries it. */
    } finally {
      this.draining = false;
    }
  }
}
