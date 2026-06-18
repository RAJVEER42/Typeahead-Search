// Consistent-hash ring with virtual nodes. Decides which cache shard owns a
// given prefix key. Two properties matter:
//
//   1. the same key always maps to the same node (so a cached prefix is found
//      on the node that filled it);
//   2. adding/removing a node remaps only ~1/N of keys, not all of them — so
//      scaling the cache doesn't cold-start the whole thing.
//
// Each physical node is placed at `vnodes` positions around a 2^32 ring; more
// vnodes => smoother key distribution. A key is owned by the first vnode
// clockwise from its hash.

const encoder = new TextEncoder();

/**
 * MurmurHash3 x86 32-bit over the UTF-8 bytes of `key`. Hashing bytes (not
 * `charCodeAt`) keeps the distribution uniform for non-ASCII queries too.
 */
export function murmur3(key: string, seed = 0): number {
  const data = encoder.encode(key);
  const len = data.length;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h = seed >>> 0;
  let i = 0;

  // body: consume 4 bytes (one little-endian block) at a time.
  const blocks = len & ~3;
  for (; i < blocks; i += 4) {
    let k =
      (data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24)) >>> 0;
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }

  // tail: the trailing 1-3 bytes.
  let k1 = 0;
  switch (len & 3) {
    case 3:
      k1 ^= data[i + 2]! << 16;
    // falls through
    case 2:
      k1 ^= data[i + 1]! << 8;
    // falls through
    case 1:
      k1 ^= data[i]!;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h ^= k1;
  }

  // fmix32 — the avalanche step that makes small input changes scatter widely.
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface RingDebug {
  key: string;
  keyHash: number;
  ringPosition: number;
  ownerNode: string;
  wrappedAround: boolean;
  totalVnodes: number;
}

export class HashRing {
  // positions kept sorted for binary search; owner maps a position -> node id.
  private positions: number[] = [];
  private owner = new Map<number, string>();
  private nodes = new Set<string>();

  constructor(private readonly vnodes = 160) {}

  get nodeCount(): number {
    return this.nodes.size;
  }

  addNode(node: string): void {
    if (this.nodes.has(node)) return;
    this.nodes.add(node);
    for (let i = 0; i < this.vnodes; i++) {
      let pos = murmur3(`${node}#${i}`);
      // resolve the rare position collision by probing forward.
      while (this.owner.has(pos)) pos = (pos + 1) >>> 0;
      this.owner.set(pos, node);
      this.insertSorted(pos);
    }
  }

  removeNode(node: string): void {
    if (!this.nodes.delete(node)) return;
    this.positions = this.positions.filter((p) => this.owner.get(p) !== node);
    for (const [pos, n] of this.owner) if (n === node) this.owner.delete(pos);
  }

  /** The node that owns `key`: the first virtual node clockwise from its hash. */
  getNode(key: string): string {
    if (this.positions.length === 0) throw new Error("hash ring is empty");
    const h = murmur3(key);
    const idx = this.upperBound(h) % this.positions.length; // % => wrap at the top
    return this.owner.get(this.positions[idx]!)!;
  }

  /** Routing detail for the /cache/debug endpoint. */
  debug(key: string): RingDebug {
    const h = murmur3(key);
    const ub = this.upperBound(h);
    const idx = ub % this.positions.length;
    const pos = this.positions[idx]!;
    return {
      key,
      keyHash: h,
      ringPosition: pos,
      ownerNode: this.owner.get(pos)!,
      wrappedAround: ub === this.positions.length, // hash fell past the last vnode
      totalVnodes: this.positions.length,
    };
  }

  /** Count how many of `keys` land on each node — used to prove balance. */
  distribution(keys: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const n of this.nodes) out[n] = 0;
    for (const k of keys) out[this.getNode(k)]!++;
    return out;
  }

  // first index whose position is strictly greater than h.
  private upperBound(h: number): number {
    let lo = 0;
    let hi = this.positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.positions[mid]! <= h) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private insertSorted(pos: number): void {
    const i = this.upperBound(pos);
    this.positions.splice(i, 0, pos);
  }
}
