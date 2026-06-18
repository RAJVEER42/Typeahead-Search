// Shared shapes used across libs, routes, and (mirrored on) the web client.

// "count"   -> rank by all-time popularity (the 60% baseline).
// "recency" -> blend popularity with decayed recent activity (the +20%).
export type Mode = "count" | "recency";

// One completion returned to the client. `count` is always the all-time count
// so the UI can show it even when ranking is recency-weighted.
export interface Suggestion {
  query: string;
  count: number;
}

// Where a /suggest response was served from. Doubles as the served-via signal
// the UI badge renders.
export type Source = "l1" | "redis" | "trie" | "empty";

export interface SuggestResponse {
  prefix: string;
  mode: Mode;
  source: Source;
  node?: string; // owning cache shard, when redis/trie was consulted
  suggestions: Suggestion[];
  tookMs?: number;
}

export interface TrendingEntry {
  query: string;
  score: number;
}

// One query as it lives in postgres and is loaded into the trie. `recent` is
// the recency score as of `ts`; the trie/SQL decay it forward to read time.
export interface QueryRow {
  query: string;
  count: number;
  recent: number;
  ts: number; // epoch ms of last activity
}

export interface MetricsSnapshot {
  cacheHits: number;
  cacheMisses: number;
  cacheErrors: number;
  cacheHitRate: number;
  l1Hits: number;
  dbReads: number;
  dbWrites: number;
  dbWriteBatches: number;
  searchesReceived: number;
  writeReductionFactor: number | null;
  suggestLatencyMs: { samples: number; p50: number; p95: number; p99: number };
  trieSize: number;
  walPending: number;
  cacheNodes: string[];
}
