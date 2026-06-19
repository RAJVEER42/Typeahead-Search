// Trending = "what's hot right now", which is recency, not all-time count. A
// single redis sorted set holds the leaderboard: each search bumps a member's
// score, and a background sweep multiplies every score down on a fixed cadence.
//
// The sweep is what stops a one-hour spike from trending forever — the same
// exponential-decay half-life the ranking uses, applied per sweep instead of
// continuously. Dust below EPSILON is dropped and the set is trimmed to CAP so
// it can't grow without bound.

import { config } from "../config.js";
import type { CacheCluster } from "./cache.js";
import type { TrendingEntry } from "../types.js";

const KEY = "trending:zset";
const CAP = 500;
const EPSILON = 0.01; // scores below this are rounding dust — drop the member

export class Trending {
  // multiply every score by this each sweep -> matches the ranking half-life.
  private readonly decayPerSweep = Math.exp(
    -(Math.LN2 / config.ranking.halfLifeSec) * (config.trending.decayIntervalMs / 1000),
  );
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly cache: CacheCluster) {}

  // route the zset like any other key, so it lives on (and survives with) a
  // known shard rather than scattering.
  private client() {
    return this.cache.clientFor(KEY);
  }

  /** Bump a coalesced window of searches in one pipeline. Best-effort. */
  async bumpMany(window: Map<string, number>): Promise<void> {
    if (window.size === 0) return;
    try {
      const pipe = this.client().pipeline();
      for (const [query, inc] of window) pipe.zincrby(KEY, inc, query);
      await pipe.exec();
    } catch {
      /* trending is best-effort; a dropped bump self-heals on the next search */
    }
  }

  /** Top `n` trending queries, highest score first. */
  async top(n: number): Promise<TrendingEntry[]> {
    const k = Math.min(Math.max(n, 1), 50);
    try {
      const flat = await this.client().zrevrange(KEY, 0, k - 1, "WITHSCORES");
      const out: TrendingEntry[] = [];
      for (let i = 0; i < flat.length; i += 2) {
        out.push({ query: flat[i]!, score: Math.round(Number(flat[i + 1]) * 1000) / 1000 });
      }
      return out;
    } catch {
      return [];
    }
  }

  startDecay(): void {
    this.timer = setInterval(() => void this.sweep(), config.trending.decayIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // decay every member, drop the dust, trim to CAP. one pipeline.
  private async sweep(): Promise<void> {
    try {
      const client = this.client();
      const flat = await client.zrange(KEY, 0, -1, "WITHSCORES");
      const pipe = client.pipeline();
      for (let i = 0; i < flat.length; i += 2) {
        const member = flat[i]!;
        const next = Number(flat[i + 1]) * this.decayPerSweep;
        if (next < EPSILON) pipe.zrem(KEY, member);
        else pipe.zadd(KEY, next, member);
      }
      pipe.zremrangebyrank(KEY, 0, -(CAP + 1)); // keep only the top CAP
      await pipe.exec();
    } catch {
      /* skip this sweep; the next one catches up */
    }
  }
}
