import { test } from "node:test";
import assert from "node:assert/strict";
import { HashRing, murmur3 } from "./hashRing.js";

const NODES = ["localhost:7070", "localhost:7071", "localhost:7072"];
const keys = (n: number): string[] => Array.from({ length: n }, (_, i) => `prefix-${i}`);

test("murmur3 is deterministic and an unsigned 32-bit integer", () => {
  const h = murmur3("react");
  assert.equal(h, murmur3("react"));
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  assert.notEqual(murmur3("react"), murmur3("redux"));
});

test("a key always maps to the same node", () => {
  const ring = new HashRing(160);
  NODES.forEach((n) => ring.addNode(n));
  const first = ring.getNode("iphone");
  for (let i = 0; i < 100; i++) assert.equal(ring.getNode("iphone"), first);
});

test("keys spread roughly evenly across nodes", () => {
  const ring = new HashRing(160);
  NODES.forEach((n) => ring.addNode(n));
  const dist = ring.distribution(keys(6000));
  const ideal = 6000 / NODES.length;
  for (const n of NODES) {
    const share = dist[n]!;
    assert.ok(Math.abs(share - ideal) / ideal < 0.3, `${n} got ${share}, ideal ~${ideal}`);
  }
});

test("removing a node remaps only a minority of keys and never returns the dead node", () => {
  const ring = new HashRing(160);
  NODES.forEach((n) => ring.addNode(n));
  const sample = keys(5000);
  const before = new Map(sample.map((k) => [k, ring.getNode(k)]));

  ring.removeNode(NODES[2]!);

  let moved = 0;
  for (const k of sample) {
    const now = ring.getNode(k);
    assert.notEqual(now, NODES[2]); // dead node is never handed out
    if (now !== before.get(k)) moved++;
  }
  // only keys that lived on the removed node should move (~1/3), not all of them.
  assert.ok(moved / sample.length < 0.45, `remapped ${moved}/${sample.length}`);
});
