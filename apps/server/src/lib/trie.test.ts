import { test } from "node:test";
import assert from "node:assert/strict";
import { CompletionTrie } from "./trie.js";
import type { QueryRow } from "../types.js";

const now = Date.now();
const row = (query: string, count: number, recent = 0, ts = now): QueryRow => ({
  query,
  count,
  recent,
  ts,
});

function seed(): CompletionTrie {
  const t = new CompletionTrie();
  t.build([row("react", 100), row("realtime", 75), row("redux", 50), row("svelte", 200)]);
  return t;
}

test("count mode returns prefix matches ordered by count, descending", () => {
  const t = seed();
  const out = t.getSuggestions("re", 10, "count").map((s) => s.query);
  assert.deepEqual(out, ["react", "realtime", "redux"]);
});

test("the K limit is respected", () => {
  const t = seed();
  assert.equal(t.getSuggestions("re", 2, "count").length, 2);
});

test("empty prefix and no-match prefix both return nothing", () => {
  const t = seed();
  assert.deepEqual(t.getSuggestions("", 10, "count"), []);
  assert.deepEqual(t.getSuggestions("zzz", 10, "count"), []);
});

test("an increment re-ranks an existing query without a rebuild", () => {
  const t = seed();
  t.applyIncrements(new Map([["redux", 100]])); // 50 -> 150, now the top "re*"
  assert.equal(t.getSuggestions("re", 10, "count")[0]!.query, "redux");
});

test("a brand-new query becomes searchable immediately", () => {
  const t = seed();
  t.applyIncrements(new Map([["reactive", 5]]));
  const out = t.getSuggestions("rea", 10, "count").map((s) => s.query);
  assert.ok(out.includes("reactive"));
});

test("recency mode lifts a fresh query over a more popular but stale one", () => {
  const t = new CompletionTrie();
  const old = now - 10 * 3600 * 1000; // long ago: react's recency has decayed away
  t.build([row("react", 1000, 0, old), row("reactjs", 10, 50, now)]);

  assert.equal(t.getSuggestions("rea", 10, "count")[0]!.query, "react");
  assert.equal(t.getSuggestions("rea", 10, "recency")[0]!.query, "reactjs");
});
