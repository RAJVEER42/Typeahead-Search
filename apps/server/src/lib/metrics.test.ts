import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, recordLatency } from "./metrics.js";

test("percentile of an empty sample set is zero", () => {
  assert.equal(percentile(50), 0);
});

test("percentile picks the expected sample by nearest rank", () => {
  for (let i = 1; i <= 100; i++) recordLatency(i);
  // p50 sits near the middle, p99 near the top.
  assert.ok(percentile(50) >= 50 && percentile(50) <= 51);
  assert.ok(percentile(99) >= 99 && percentile(99) <= 100);
  assert.ok(percentile(95) >= 95 && percentile(95) <= 97);
});
