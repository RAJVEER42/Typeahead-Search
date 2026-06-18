// Pure scoring functions, shared by the trie (read-time ranking) and the
// store (SQL-side recency decay). Kept side-effect free so they are trivial
// to unit-test and reason about.
//
// The recency model is exponential decay: a query's `recent` score halves
// after `halfLifeSec` of inactivity, so a short-lived spike fades instead of
// ranking forever. That is what stops "popular for an hour" from out-ranking
// "popular for years" permanently.

import { config } from "../config.js";
import type { Mode } from "../types.js";

const LAMBDA = Math.LN2 / config.ranking.halfLifeSec;

/** Decay a recency score forward by `dtSeconds`. No-op for dt <= 0. */
export function decay(recent: number, dtSeconds: number): number {
  if (dtSeconds <= 0) return recent;
  return recent * Math.exp(-LAMBDA * dtSeconds);
}

/**
 * Blend all-time popularity with recent activity. log1p on the count tames the
 * power law — without it a query with millions of hits would drown out any
 * amount of recency, and the recency term would never move the ranking.
 */
export function hybridScore(count: number, recent: number): number {
  return config.ranking.wPop * Math.log1p(count) + config.ranking.wRec * recent;
}

/** count mode -> raw count; recency mode -> the hybrid blend. */
export function scoreFor(mode: Mode, count: number, recent: number): number {
  return mode === "count" ? count : hybridScore(count, recent);
}
