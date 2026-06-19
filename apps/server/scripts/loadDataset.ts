// Dataset loader. Two modes:
//
//   tsx scripts/loadDataset.ts --synthetic 120000
//   tsx scripts/loadDataset.ts --file data/queries.tsv
//
// --synthetic generates a power-law (Zipfian) set of search queries: a few
// head terms with huge counts, a long tail with small ones — the same shape
// real query logs have, which is what makes caching and ranking interesting.
//
// --file ingests an open dataset. Lines of "query<TAB>count" are used as-is;
// a file of one raw query per line is aggregated into counts (the assignment's
// "derive counts by aggregation"). Either way the table is replaced.

import { readFileSync } from "node:fs";
import { Store } from "../src/lib/store.js";

// deterministic PRNG so the synthetic dataset is reproducible run to run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// many queries share these first tokens -> shared character prefixes, which is
// exactly what makes a typeahead demo interesting ("ip" -> iphone, ipad, ...).
const HEADS = [
  "iphone", "ipad", "ipod", "ip address", "samsung", "google", "youtube", "facebook",
  "python", "java", "javascript", "react", "redux", "node", "php", "perl", "rust", "ruby",
  "how to", "what is", "best", "buy", "cheap", "free", "download", "weather", "news",
  "amazon", "netflix", "spotify", "tesla", "nike", "adidas", "pizza", "coffee", "laptop",
  "macbook", "windows", "linux", "docker", "kubernetes", "redis", "postgres", "mongodb",
  "machine learning", "deep learning", "data structures", "system design", "interview",
];

const TAILS = [
  "tutorial", "review", "price", "near me", "online", "2024", "pro", "max", "case", "charger",
  "vs", "for beginners", "cheat sheet", "example", "error", "not working", "install", "setup",
  "guide", "documentation", "api", "library", "framework", "course", "free download", "lyrics",
  "recipe", "delivery", "stock", "share price", "login", "sign up", "support", "alternative",
  "comparison", "benchmark", "performance", "memory", "cluster", "sharding", "consistent hashing",
  "cache", "latency", "throughput", "scaling", "questions", "answers", "salary", "remote",
];

function synthesize(n: number): Map<string, number> {
  const rand = mulberry32(0x5eed);
  const set = new Set<string>();
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

  // build n distinct queries: a head token plus 0-3 tail tokens.
  let guard = 0;
  while (set.size < n && guard < n * 50) {
    guard++;
    const parts = [pick(HEADS)];
    const extra = Math.floor(rand() * 4); // bias toward shorter queries
    for (let i = 0; i < extra; i++) parts.push(pick(TAILS));
    set.add(parts.join(" "));
  }

  // assign Zipfian counts: shuffle for a random popularity order, then
  // count(rank) = C / (rank+1)^1.05 — top query ~millions, tail ~single digits.
  const queries = [...set];
  for (let i = queries.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [queries[i], queries[j]] = [queries[j]!, queries[i]!];
  }
  const C = 2_000_000;
  const out = new Map<string, number>();
  queries.forEach((q, rank) => out.set(q, Math.max(1, Math.round(C / Math.pow(rank + 1, 1.05)))));
  return out;
}

function fromFile(path: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const row = line.trim();
    if (!row) continue;
    const tab = row.indexOf("\t");
    if (tab !== -1) {
      const q = row.slice(0, tab).toLowerCase().trim();
      const c = Number.parseInt(row.slice(tab + 1), 10) || 1;
      if (q) out.set(q, (out.get(q) ?? 0) + c);
    } else {
      const q = row.toLowerCase();
      out.set(q, (out.get(q) ?? 0) + 1); // aggregate raw query log
    }
  }
  return out;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const file = arg("--file");
  const data = file ? fromFile(file) : synthesize(Number.parseInt(arg("--synthetic") ?? "120000", 10));

  const rows = [...data.entries()].map(([query, count]) => ({ query, count }));
  console.log(`loading ${rows.length.toLocaleString()} distinct queries${file ? ` from ${file}` : " (synthetic)"}...`);

  const store = new Store();
  await store.ready();
  await store.initSchema();
  await store.truncate();
  const t0 = performance.now();
  await store.bulkLoad(rows);
  console.log(`done in ${(performance.now() - t0).toFixed(0)}ms`);
  await store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
