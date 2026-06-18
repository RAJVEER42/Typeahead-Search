// The serving structure. A prefix trie where every node caches its own top-K
// completions, so a lookup is O(prefix length) — walk to the node, read its
// pre-sorted pool. No descendant scan, no DB query. That is the whole point:
// keystrokes are reads, and reads must be cheap.
//
// Counts only ever go up, so maintaining the pools is cheap: when a query's
// count rises we bubble it up the few nodes on its path and re-place it in
// each small pool. Memory is POOL * node_count — fine into the low millions of
// queries; past that you'd cap the trie by depth.

import { decay, scoreFor } from "./ranking.js";
import type { Mode, QueryRow, Suggestion } from "../types.js";

const POOL = 25; // completions cached per node; must be >= the K we ever serve.
const MAX_QUERY_LEN = 120; // bound trie depth; nobody types a 120-char prefix.

interface TrieNode {
  children: Map<string, TrieNode>;
  // query strings sorted by all-time count, descending. capped at POOL.
  top: string[];
}

interface QueryStat {
  count: number;
  recent: number;
  ts: number; // epoch ms of last update; recency is decayed forward from here
}

const newNode = (): TrieNode => ({ children: new Map(), top: [] });

export class CompletionTrie {
  private root: TrieNode = newNode();
  // the single source of truth for a query's numbers. nodes hold only the
  // query *string*, never a copy of the count — so the count exists once.
  private stats = new Map<string, QueryStat>();

  get size(): number {
    return this.stats.size;
  }

  /** Replace the whole index from durable rows (called once on boot). */
  build(rows: QueryRow[]): void {
    this.root = newNode();
    this.stats.clear();
    for (const r of rows) {
      const q = r.query.slice(0, MAX_QUERY_LEN);
      if (!q) continue;
      this.stats.set(q, { count: r.count, recent: r.recent, ts: r.ts });
    }
    for (const q of this.stats.keys()) this.bubble(q);
  }

  /**
   * Apply one coalesced flush window: { query -> increment }. Keeps the live
   * index in sync with what just landed in the durable store, so suggestions
   * reflect new searches without waiting for a rebuild.
   */
  applyIncrements(window: Map<string, number>, now = Date.now()): void {
    for (const [raw, inc] of window) {
      const q = raw.slice(0, MAX_QUERY_LEN);
      if (!q || inc <= 0) continue;
      const s = this.stats.get(q);
      if (s) {
        const dt = (now - s.ts) / 1000;
        s.count += inc;
        s.recent = decay(s.recent, dt) + inc; // decay to now, then add the bump
        s.ts = now;
      } else {
        this.stats.set(q, { count: inc, recent: inc, ts: now });
      }
      this.bubble(q);
    }
  }

  /**
   * Top-K completions for `prefix`. In count mode the pool is already in the
   * right order, so we just slice it. In recency mode we re-rank the ~POOL
   * candidates by the hybrid score — a handful of rows, never a tree walk.
   */
  getSuggestions(prefix: string, k: number, mode: Mode, now = Date.now()): Suggestion[] {
    const node = this.navigate(prefix);
    if (!node) return [];

    if (mode === "count") {
      const out: Suggestion[] = [];
      for (let i = 0; i < node.top.length && out.length < k; i++) {
        const q = node.top[i]!;
        out.push({ query: q, count: this.stats.get(q)!.count });
      }
      return out;
    }

    // recency: score the pool with decayed recency, then take the best K.
    const scored = node.top.map((q) => {
      const s = this.stats.get(q)!;
      const rec = decay(s.recent, (now - s.ts) / 1000);
      return { query: q, count: s.count, score: scoreFor("recency", s.count, rec) };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(({ query, count }) => ({ query, count }));
  }

  // walk to the node for `prefix`, or undefined if no query has that prefix.
  private navigate(prefix: string): TrieNode | undefined {
    let node: TrieNode | undefined = this.root;
    for (const ch of prefix) {
      node = node.children.get(ch);
      if (!node) return undefined;
    }
    return node;
  }

  // re-place `q` in the pool of every prefix node on its path, creating nodes
  // as needed. O(prefix length * POOL) — cheap because both factors are small.
  private bubble(q: string): void {
    let node = this.root;
    for (const ch of q) {
      let next = node.children.get(ch);
      if (!next) {
        next = newNode();
        node.children.set(ch, next);
      }
      this.poolInsert(next, q);
      node = next;
    }
  }

  // insertion-sort `q` into node.top by descending count. counts are monotonic,
  // so a query already present can only move up.
  private poolInsert(node: TrieNode, q: string): void {
    const c = this.stats.get(q)!.count;
    const top = node.top;

    const existing = top.indexOf(q);
    if (existing !== -1) top.splice(existing, 1); // remove so we can re-place
    else if (top.length >= POOL) {
      const weakest = this.stats.get(top[top.length - 1]!)!.count;
      if (c <= weakest) return; // doesn't make the cut
    }

    let i = top.length;
    while (i > 0 && this.stats.get(top[i - 1]!)!.count < c) i--;
    top.splice(i, 0, q);
    if (top.length > POOL) top.pop();
  }
}
