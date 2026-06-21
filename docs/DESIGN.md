# Design notes

The decisions behind the system, the alternatives that were rejected, and the
limits that are known and accepted. The guiding assumption throughout:

> In a search box, **reads outnumber writes by roughly 5–10×** (every keystroke
> is a read; only a submitted search is a write), and a suggestion is allowed to
> be slightly stale. So: make reads cheap, keep writes off the hot path, and
> treat "roughly popular" as good enough.

A back-of-envelope to anchor it: ~10M daily active users × ~4 searches each is
~40M searches/day ≈ **460 writes/s** average. But each search is several
keystrokes, so reads are **a few thousand/s average and ~10k/s at peak**. The
architecture follows the bigger number.

---

## 1. Serving: a trie with a cached top-K per node

A suggestion request must return the top-K completions of a prefix. The options:

- **`SELECT ... WHERE query LIKE 'ip%' ORDER BY count DESC LIMIT 10`** — correct,
  but a database round-trip and an index scan on every keystroke. Rejected: too
  slow and it puts the read load on the one component we most want to protect.
- **Trie + DFS at query time** — walk to the prefix node, depth-first to collect
  all completions, sort, take K. Correct but O(descendants); a one- or two-letter
  prefix can have an enormous subtree.
- **Trie with a cached top-K pool per node** — *chosen.* Every node stores its own
  pre-sorted list of the best `POOL` (25) completions. A lookup is **O(prefix
  length)**: walk to the node, read its pool. No subtree scan.

Why the pool stays cheap to maintain: counts only ever go **up**. When a query's
count rises, it can only move up in a pool, never down — so re-placing it is an
insertion sort over a 25-element array on the handful of nodes along its path
(`bubble` / `poolInsert` in [`trie.ts`](../apps/server/src/lib/trie.ts)). New
queries appear immediately; there is no periodic full rebuild needed to keep the
index fresh (a rebuild happens only once, at boot, from Postgres).

Cost: `POOL × node_count` memory. Fine into the low millions of queries; past
that you would cap the trie by depth. Noted in *Known limits*.

---

## 2. Ranking: count (baseline) vs recency (enhanced)

Same `/suggest` endpoint, a `mode` parameter.

- **`count`** (the 60% baseline): rank by all-time count. The pool is already
  stored in count order, so this is a slice — zero extra work.
- **`recency`** (the +20%): blend popularity with recent activity so a query that
  is surging *right now* can outrank a stale giant.

The score:

```
score = w_pop · log1p(count) + w_rec · recent        (w_pop=1, w_rec=2)
recent decays:  recent(t) = recent · e^(−λ·Δt),  λ = ln2 / half_life   (half_life = 30 min)
```

- **`log1p(count)`** tames the power law. Without it a query with millions of
  all-time hits would swamp the recency term and recency could never move the
  ranking. The log puts counts on a comparable scale to the recency signal.
- **Decay with a half-life** is what stops a one-hour spike from ranking forever:
  "how recent searches are tracked" (a decayed score per query, bumped on every
  flush) and "how the system avoids permanently over-ranking a short-lived
  spike" (the score halves every 30 min of inactivity) are the same mechanism.

Recency re-ranking is done **only over the ~25-element pool**, never the tree —
the pool is a popularity-ordered superset, so reordering a handful of rows is
enough. (Trade-off: a recency surge on a query that isn't in the top-25 *by
count* for its prefix can't surface for that prefix until its count climbs into
the pool. Accepted; widening the pool trades memory for recall.)

Demonstrated live: after a burst of searches for `redis cluster sharding` (a
long-tail query), it is absent from `mode=count` for prefix `red` but **rank 1
under `mode=recency`** — see [PERFORMANCE.md](PERFORMANCE.md).

---

## 3. Caching: two layers, cache-aside, write-around

"Use a cache before falling back to the primary store." Here the primary serving
structure is the trie, and there are two cache layers in front of it:

- **L1 — in-process TTL cache** (per app instance, ~1.5s TTL). Absorbs the
  hottest prefixes (`a`, `ip`, `wh`…) so they never cross the network and, just
  as importantly, never pin a single Redis node (the hot-key problem). Microsecond
  hits. In the benchmark L1 served ~99% of repeated reads.
- **L2 — distributed Redis cache** (§5). The shared, larger cache that survives an
  app restart and is consistent across instances.

Both are **cache-aside**: on a miss the route computes from the trie and backfills
the cache. Writes are **write-around** — a count update never writes the cache;
the short TTL is the only invalidation. This neatly answers "how is the cache
updated/invalidated when rankings change?": it isn't actively invalidated, it
simply expires, and the jittered TTL bounds staleness. Rejected alternative —
**write-through / active invalidation** on every count change: far more cache
writes and cross-talk for a feature that tolerates a few seconds of staleness.

**Jittered TTL** (±20%): a burst of fills that all set a 45s TTL would all expire
on the same tick and stampede the trie. Spreading the expiry smooths that out.

---

## 4. Distribution: consistent hashing with virtual nodes

The cache is **N independent Redis servers, not Redis Cluster** — routing is done
in the app, which is the point of the exercise.

- **Why not `node = hash(key) % N`?** Changing `N` (adding a shard) remaps almost
  every key — a full cache cold-start. Rejected.
- **Consistent hashing** maps both keys and nodes onto a 2³² ring; a key is owned
  by the first node clockwise. Adding/removing a node remaps only ~1/N of keys.
- **Virtual nodes (160/node):** one position per node clusters badly; 160 spreads
  each node's ownership around the ring so load is even (measured within ~2% of
  ideal across three shards).
- **Hash choice:** MurmurHash3 over **UTF-8 bytes**. Fast (no crypto), good
  avalanche, and correct for non-ASCII queries (a naive `charCodeAt & 0xff` would
  collapse multibyte characters and skew the distribution).

`count` and `recency` keys for the same prefix share a node (`sugg:<mode>:<prefix>`),
so a prefix's entries cluster instead of scattering. The WAL list and trending
zset are routed the same way, so they live on a known shard.

---

## 5. Eviction & graceful degradation

- **Eviction:** Redis runs `--maxmemory-policy volatile-lru`. Only TTL'd keys (the
  suggestion cache) are evictable under pressure; the WAL and trending zset carry
  no TTL and so are never evicted, and `appendonly yes` makes them crash-safe.
- **A node going down is not an outage.** Every Redis call is wrapped: on
  error the read is reported as a miss and **the trie answers** — verified by
  killing a shard mid-traffic and seeing `/suggest` keep returning `200`s while
  `cacheErrors` ticked up. Losing a shard costs ~1/N of the cache (a brief dip in
  hit rate), not correctness. Both common reference implementations 500 here; this
  one degrades.

---

## 6. Writes: write-behind batching over a durable WAL

`POST /search` must not write Postgres per request. Instead:

1. The search is appended to a **Redis list** (`wal:searches`) — `RPUSH` — and the
   request returns immediately (`{ "message": "Searched" }`). The durable unit of
   work is the append, not a DB write.
2. A **drainer** pulls a window every second, **or** the moment the list crosses
   the batch size (flush-on-size catches bursts; flush-on-interval catches the
   tail). It **coalesces** duplicates (50× `iphone` becomes one `+50`), then
   applies the window once to Postgres, the trie, and the trending zset.

- **Why a Redis list, not an in-memory Map?** Durability. An in-memory buffer is
  *at-most-once*: a crash loses the whole un-flushed window. The WAL survives a
  process restart.
- **At-least-once, by choice.** The drainer **processes then trims** (`LTRIM`
  after Postgres has the window). A crash mid-flush replays a window —
  double-counting a few searches rather than dropping them. For approximate
  popularity counts, a rare small over-count is the right trade vs. lost data.
  (Exactly-once would need a per-batch idempotency token or `LMOVE` to a
  processing list — added complexity this workload doesn't justify.)
- **Failure trade-off (the assignment's explicit ask):** if the process crashes
  *before* a flush, the un-flushed window is still in Redis and the next drain
  picks it up. If the **WAL node itself** is down at write time, that search is
  lost — a single-node SPOF for writes, accepted for simplicity; mitigations would
  be sharding the WAL or a quorum append.

Measured effect: 20,000 searches collapsed to **774 row-writes in 18
transactions** — ~25.8× fewer rows and ~1111× fewer transactions than writing per
search.

---

## 7. Trending: a decaying sorted set

Trending is recency, not all-time count, so it gets its own structure: a Redis
sorted set. Each flush `ZINCRBY`s the window; a background sweep every 30s
multiplies every score down by the same half-life as the ranking, drops members
below a dust threshold, and `ZREMRANGEBYRANK`-trims to the top 500 so it can't
grow without bound. This is "windowing by decay" — no explicit time buckets to
manage.

---

## 8. Store: Postgres, additive upsert, decay-in-SQL

Postgres is the durable source of truth and is rebuilt into the trie at boot; it
is never read on the suggestion path (`dbReads = 0` by design). Two write modes:

- **`COPY ... FROM STDIN`** for bulk dataset ingestion (120k rows in ~0.5s).
- **Additive `INSERT ... ON CONFLICT DO UPDATE`** for flushes:
  `count = count + EXCLUDED.count`, and recency is **decayed in SQL** using
  `last_searched` before the increment is added. Doing the decay in the upsert
  (a) means two racing flushes *add* instead of clobbering, and (b) makes recency
  **survive a restart** — it is reloaded into the trie at boot.

---

## 9. Consistency

Eventual, and deliberately so. A submitted search shows up in suggestions/trending
after the next flush (≤ ~1s) and a cached prefix can be up to its TTL stale. In
PACELC terms this is **PA/EL**: if a shard partitions we stay Available (degrade
to the trie), and Else we favor Latency over strict Consistency. Correct for a
typeahead; wrong for a bank ledger.

---

## Summary

| Decision | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Serving | trie + cached top-K/node | `LIKE` query; DFS-per-request | O(prefix), no DB on reads |
| Ranking | count, or log+decay blend | linear count only | recency without permanent over-rank |
| Cache layers | L1 in-proc + Redis | Redis only | kills hot-key + network on hot prefixes |
| Cache strategy | cache-aside + write-around + jittered TTL | write-through/active invalidation | fewer writes; staleness is fine |
| Sharding | consistent hashing, 160 vnodes, app-side | `hash % N`; Redis Cluster | minimal remap; routing is the assignment |
| Hash | murmur3 over UTF-8 | MD5; `charCodeAt & 0xff` | fast + correct for non-ASCII |
| Node down | degrade to trie | 500 | availability |
| Writes | write-behind, durable WAL, coalesce | sync per-request; in-memory buffer | ~1000× fewer txns; survives restart |
| Delivery | at-least-once (process-then-trim) | at-most-once; exactly-once | never drop; rare double is fine |

## Known limits

- **Hot key:** a single very hot prefix still concentrates on one shard. L1 hides
  most of it; true fix would be hot-key replication.
- **At-least-once double-count** on a crash mid-flush (accepted).
- **WAL is a single routed node** — a write-path SPOF (accepted; shardable).
- **Trie is unbounded** — grows with distinct queries; memory is the ceiling
  past ~1M (would cap by depth).
- **Metrics are per-process** and reset on restart — fine for the demo, not a
  multi-instance telemetry story (that's Prometheus).
