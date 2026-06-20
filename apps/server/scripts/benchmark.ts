// End-to-end benchmark against a running server. Produces the real numbers the
// performance report cites: suggest latency (client + server), cache hit rate,
// write-reduction from batching, ring balance, and a recency-vs-count demo.
//
//   tsx scripts/benchmark.ts                 # defaults
//   READS=8000 WRITES=20000 tsx scripts/benchmark.ts

const BASE = process.env.BASE ?? "http://localhost:8080";
const READS = Number.parseInt(process.env.READS ?? "8000", 10);
const WRITES = Number.parseInt(process.env.WRITES ?? "20000", 10);
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY ?? "50", 10);

// realistic short prefixes — repetition across READS is what builds cache hits.
const PREFIXES = [
  "i", "ip", "ipa", "ipo", "sa", "go", "yo", "fa", "py", "ja", "jav", "re", "red", "no",
  "ho", "wh", "be", "bes", "bu", "ch", "fr", "do", "doc", "we", "ne", "am", "ma", "mac",
  "li", "lin", "ru", "po", "pos", "mo", "mon", "sy", "sys", "in", "int", "de", "dee", "da", "dat",
];

const pct = (arr: number[], p: number): number => {
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.round((p / 100) * (s.length - 1))]! * 1000) / 1000;
};

// run `total` tasks `concurrency` at a time.
async function pool(total: number, concurrency: number, task: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < total) await task(next++);
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

const get = async (path: string): Promise<any> => (await fetch(BASE + path)).json();

async function suggestLatency(): Promise<void> {
  console.log(`\n=== suggest latency (${READS} reads, concurrency ${CONCURRENCY}) ===`);
  // warm the cache so we measure steady state, not a cold start.
  for (const p of PREFIXES) await get(`/suggest?q=${p}`);

  const client: number[] = [];
  const server: number[] = [];
  await pool(READS, CONCURRENCY, async () => {
    const p = PREFIXES[Math.floor(Math.random() * PREFIXES.length)]!;
    const t0 = performance.now();
    const r = await get(`/suggest?q=${p}`);
    client.push(performance.now() - t0);
    if (typeof r.tookMs === "number") server.push(r.tookMs);
  });

  console.log(`client  p50 ${pct(client, 50)}ms  p95 ${pct(client, 95)}ms  p99 ${pct(client, 99)}ms`);
  console.log(`server  p50 ${pct(server, 50)}ms  p95 ${pct(server, 95)}ms  p99 ${pct(server, 99)}ms`);

  const m = await get("/metrics");
  // effective hit rate counts both layers: anything not served from L1 or redis
  // had to be (re)built by the trie.
  const served = m.l1Hits + m.cacheHits + m.cacheMisses;
  const effective = served === 0 ? 0 : ((m.l1Hits + m.cacheHits) / served) * 100;
  console.log(`effective hit rate ${effective.toFixed(1)}%  (l1 ${m.l1Hits}, redis ${m.cacheHits}, trie/miss ${m.cacheMisses})`);
  console.log(`redis-only hit rate ${(m.cacheHitRate * 100).toFixed(1)}% (L1 shields most reads from redis)`);
  console.log(`db reads on suggest path: ${m.dbReads}`);
}

async function writeReduction(): Promise<void> {
  console.log(`\n=== write reduction (${WRITES} searches) ===`);
  const before = await get("/metrics");
  // draw from a small hot set so coalescing has plenty to fold.
  const hot = PREFIXES.map((p) => `${p}hone search ${p}`);
  await pool(WRITES, CONCURRENCY, async (i) => {
    await fetch(`${BASE}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: hot[i % hot.length] }),
    });
  });

  // let the periodic flush drain the WAL.
  await new Promise((r) => setTimeout(r, 2500));
  const after = await get("/metrics");
  const searches = after.searchesReceived - before.searchesReceived;
  const rows = after.dbWrites - before.dbWrites;
  const batches = after.dbWriteBatches - before.dbWriteBatches;
  console.log(`searches ${searches}  ->  rows upserted ${rows}  in ${batches} batches`);
  console.log(`row reduction ~${(searches / Math.max(rows, 1)).toFixed(1)}x  |  transaction reduction ~${(searches / Math.max(batches, 1)).toFixed(0)}x`);
}

async function ringBalance(): Promise<void> {
  console.log(`\n=== consistent-hash distribution (5000 keys) ===`);
  const r = await get("/cache/ring?sample=5000");
  const total = Object.values(r.distribution as Record<string, number>).reduce((a, b) => a + b, 0);
  for (const [node, n] of Object.entries(r.distribution as Record<string, number>)) {
    console.log(`  ${node}  ${n}  (${((n / total) * 100).toFixed(1)}%)`);
  }
}

async function recencyDemo(): Promise<void> {
  console.log(`\n=== recency vs count ===`);
  const q = "redis cluster sharding"; // long-tail: low all-time count
  for (let i = 0; i < 3000; i++) {
    await fetch(`${BASE}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
  }
  await new Promise((r) => setTimeout(r, 2500));
  const byCount = (await get(`/suggest?q=red&mode=count`)).suggestions.map((s: any) => s.query);
  const byRecency = (await get(`/suggest?q=red&mode=recency`)).suggestions.map((s: any) => s.query);
  console.log(`  count   : ${byCount.slice(0, 5).join(" | ")}`);
  console.log(`  recency : ${byRecency.slice(0, 5).join(" | ")}`);
  console.log(`  -> "${q}" rank by count ${byCount.indexOf(q) + 1 || "n/a"}, by recency ${byRecency.indexOf(q) + 1 || "n/a"}`);
}

async function main(): Promise<void> {
  console.log(`benchmarking ${BASE}`);
  await suggestLatency();
  await writeReduction();
  await ringBalance();
  await recencyDemo();
  console.log("\ndone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
