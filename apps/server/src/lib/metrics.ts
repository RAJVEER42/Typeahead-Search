// Process-local metrics. Deliberately simple: a bag of counters plus a bounded
// ring buffer of suggest latencies. Everything resets on restart — these are
// for the demo's "report latency / hit rate / write reduction" ask, not a
// production telemetry pipeline (that would be prometheus, aggregated per pod).

import type { MetricsSnapshot } from "../types.js";

export const counters = {
  cacheHits: 0, // redis hits
  cacheMisses: 0, // had to fall back to the trie
  cacheErrors: 0, // redis op failed and we degraded gracefully
  l1Hits: 0, // served from the in-process L1, never touched redis
  dbReads: 0, // suggestion-path DB reads — 0 by design, the trie serves misses
  dbWrites: 0, // rows upserted by the batch writer
  dbWriteBatches: 0, // number of upsert transactions
  searchesReceived: 0, // raw POST /search count, before coalescing
};

const LAT_CAP = 5000;
const lat = new Float64Array(LAT_CAP); // ring buffer; O(1) record, no array shift
let latCount = 0;
let latIdx = 0;

export function recordLatency(ms: number): void {
  lat[latIdx] = ms;
  latIdx = (latIdx + 1) % LAT_CAP;
  if (latCount < LAT_CAP) latCount++;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// nearest-rank percentile over the recorded samples.
export function percentile(p: number): number {
  if (latCount === 0) return 0;
  const sorted = Array.from(lat.subarray(0, latCount)).sort((a, b) => a - b);
  const idx = Math.round((p / 100) * (latCount - 1));
  return round3(sorted[idx]!);
}

interface SnapshotExtra {
  trieSize: number;
  walPending: number;
  cacheNodes: string[];
}

export function snapshot(extra: SnapshotExtra): MetricsSnapshot {
  const lookups = counters.cacheHits + counters.cacheMisses;
  return {
    cacheHits: counters.cacheHits,
    cacheMisses: counters.cacheMisses,
    cacheErrors: counters.cacheErrors,
    cacheHitRate: lookups === 0 ? 0 : round3(counters.cacheHits / lookups),
    l1Hits: counters.l1Hits,
    dbReads: counters.dbReads,
    dbWrites: counters.dbWrites,
    dbWriteBatches: counters.dbWriteBatches,
    searchesReceived: counters.searchesReceived,
    // how many raw searches each persisted row represents — the batching win.
    writeReductionFactor:
      counters.dbWrites === 0 ? null : round3(counters.searchesReceived / counters.dbWrites),
    suggestLatencyMs: {
      samples: latCount,
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
    },
    trieSize: extra.trieSize,
    walPending: extra.walPending,
    cacheNodes: extra.cacheNodes,
  };
}
