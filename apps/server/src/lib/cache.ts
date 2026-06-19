// The distributed cache, in two layers.
//
//   L1 — a tiny in-process TTL cache. Absorbs the hottest prefixes ("a", "ip",
//        "what") so they never cross the network and never pin a single redis
//        node. Microsecond hits.
//   L2 — N independent redis nodes, sharded by the consistent-hash ring. NOT a
//        Redis Cluster: routing is ours, which is the assignment's point.
//
// Reads are cache-aside (miss -> caller fills from the trie). Writes are
// write-around: counts never touch the cache, a short jittered TTL is the only
// invalidation. And every redis op degrades gracefully — if a node is down the
// read is reported as a miss and the trie answers, instead of 500-ing.

import Redis from "ioredis";
import { config } from "../config.js";
import { counters } from "./metrics.js";
import { HashRing, type RingDebug } from "./hashRing.js";
import type { Mode, Suggestion } from "../types.js";

type CacheSource = "l1" | "redis";

export interface CacheRead {
  hit: boolean;
  source: CacheSource | null; // where the hit came from (null on a miss)
  node: string; // owning shard, for the UI badge / debug
  value: Suggestion[] | null;
}

// fixed-capacity TTL cache with FIFO eviction. small enough that FIFO is fine.
class L1 {
  private map = new Map<string, { value: Suggestion[]; expires: number }>();
  constructor(private readonly max: number, private readonly ttlMs: number) {}

  get(key: string): Suggestion[] | null {
    if (this.max === 0) return null;
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expires <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }

  set(key: string, value: Suggestion[]): void {
    if (this.max === 0) return;
    if (this.map.size >= this.max && !this.map.has(key)) {
      // evict the oldest inserted key.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

export class CacheCluster {
  private clients = new Map<string, Redis>();
  private ring: HashRing;
  private l1: L1;

  constructor(nodes: string[] = config.cacheNodes) {
    if (nodes.length === 0) throw new Error("no cache nodes configured");
    this.ring = new HashRing(config.cache.vnodes);
    this.l1 = new L1(config.cache.l1Max, config.cache.l1TtlMs);
    for (const node of nodes) {
      const [host, port] = node.split(":");
      const client = new Redis({
        host,
        port: Number(port),
        lazyConnect: true,
        // fail fast instead of queueing when a node is unreachable — that is
        // what lets a read degrade to the trie rather than hang.
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      });
      client.on("error", () => {}); // swallow; we count failures at the call site
      this.clients.set(node, client);
      this.ring.addNode(node);
    }
  }

  get nodes(): string[] {
    return [...this.clients.keys()];
  }

  /** Connect + ping every node. Fails fast at boot if a shard is unreachable. */
  async ready(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map(async (c) => {
        await c.connect();
        await c.ping();
      }),
    );
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.quit().catch(() => {})));
  }

  // route any key the same deterministic way the cache does — so the WAL and
  // trending leaderboard land on (and survive with) a known shard.
  nodeFor(routingKey: string): string {
    return this.ring.getNode(routingKey);
  }

  clientFor(routingKey: string): Redis {
    return this.clients.get(this.nodeFor(routingKey))!;
  }

  ringDebug(key: string): RingDebug {
    return this.ring.debug(key);
  }

  ringDistribution(keys: string[]): Record<string, number> {
    return this.ring.distribution(keys);
  }

  // count and recency for the same prefix share a node, so a prefix's cache
  // entries cluster instead of scattering.
  private key(prefix: string, mode: Mode): string {
    return `sugg:${mode}:${prefix}`;
  }

  async getSuggestions(prefix: string, mode: Mode): Promise<CacheRead> {
    const key = this.key(prefix, mode);
    const node = this.ring.getNode(key);

    const l1 = this.l1.get(key);
    if (l1) {
      counters.l1Hits++;
      return { hit: true, source: "l1", node, value: l1 };
    }

    try {
      const raw = await this.clients.get(node)!.get(key);
      if (raw) {
        const value = JSON.parse(raw) as Suggestion[];
        this.l1.set(key, value); // promote into L1 for next time
        counters.cacheHits++;
        return { hit: true, source: "redis", node, value };
      }
      counters.cacheMisses++;
      return { hit: false, source: null, node, value: null };
    } catch {
      // node down / timeout — treat as a miss so the trie answers.
      counters.cacheErrors++;
      return { hit: false, source: null, node, value: null };
    }
  }

  async setSuggestions(prefix: string, mode: Mode, value: Suggestion[]): Promise<void> {
    const key = this.key(prefix, mode);
    this.l1.set(key, value);
    try {
      await this.clients.get(this.ring.getNode(key))!.set(key, JSON.stringify(value), "EX", this.jitterTtl(config.cache.ttlSuggestSec));
    } catch {
      counters.cacheErrors++; // fine — the value is in L1 and the trie is the source
    }
  }

  /** Is this prefix currently cached, and on which shard? For /cache/debug. */
  async probe(prefix: string, mode: Mode): Promise<{ ring: RingDebug; cached: boolean }> {
    const key = this.key(prefix, mode);
    const ring = this.ring.debug(key);
    let cached = false;
    try {
      cached = (await this.clients.get(ring.ownerNode)!.exists(key)) === 1;
    } catch {
      counters.cacheErrors++;
    }
    return { ring, cached };
  }

  // jitter the ttl so a burst of fills doesn't all expire on the same tick and
  // stampede the trie. +/- ttlJitter fraction, floored at 1s.
  private jitterTtl(ttlSec: number): number {
    const spread = (Math.random() * 2 - 1) * ttlSec * config.cache.ttlJitter;
    return Math.max(1, Math.round(ttlSec + spread));
  }
}
