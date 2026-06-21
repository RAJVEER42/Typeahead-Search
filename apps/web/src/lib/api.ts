// Typed client for the server API. Types mirror apps/server/src/types.ts —
// kept in sync by hand since the two apps don't share a package.

export type Mode = "count" | "recency";
export type Source = "l1" | "redis" | "trie" | "empty";

export interface Suggestion {
  query: string;
  count: number;
}

export interface SuggestResponse {
  prefix: string;
  mode: Mode;
  source: Source;
  node?: string;
  suggestions: Suggestion[];
  tookMs?: number;
}

export interface TrendingEntry {
  query: string;
  score: number;
}

export interface Metrics {
  cacheHits: number;
  cacheMisses: number;
  cacheErrors: number;
  cacheHitRate: number;
  l1Hits: number;
  dbWrites: number;
  searchesReceived: number;
  writeReductionFactor: number | null;
  suggestLatencyMs: { samples: number; p50: number; p95: number; p99: number };
  trieSize: number;
  walPending: number;
  cacheNodes: string[];
}

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

export async function fetchSuggest(q: string, mode: Mode, signal?: AbortSignal): Promise<SuggestResponse> {
  const r = await fetch(`${BASE}/suggest?q=${encodeURIComponent(q)}&mode=${mode}`, { signal });
  if (!r.ok) throw new Error(`suggest ${r.status}`);
  return r.json();
}

export async function postSearch(query: string): Promise<void> {
  await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

// trending + metrics are ambient panels — swallow errors so a blip doesn't
// tear down the UI.
export async function fetchTrending(n = 8): Promise<TrendingEntry[]> {
  try {
    const r = await fetch(`${BASE}/trending?n=${n}`);
    return (await r.json()).trending ?? [];
  } catch {
    return [];
  }
}

export async function fetchMetrics(): Promise<Metrics | null> {
  try {
    const r = await fetch(`${BASE}/metrics`);
    return await r.json();
  } catch {
    return null;
  }
}

// key distribution across the shards — drives the ring's ownership arcs.
export type RingDistribution = Record<string, number>;

export async function fetchRing(sample = 5000): Promise<RingDistribution> {
  try {
    const r = await fetch(`${BASE}/cache/ring?sample=${sample}`);
    return (await r.json()).distribution ?? {};
  } catch {
    return {};
  }
}
