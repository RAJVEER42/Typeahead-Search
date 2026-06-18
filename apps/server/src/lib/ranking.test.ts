import { test } from "node:test";
import assert from "node:assert/strict";
import { decay, scoreFor } from "./ranking.js";
import { config } from "../config.js";

test("decay halves a score after one half-life", () => {
  const half = config.ranking.halfLifeSec;
  assert.ok(Math.abs(decay(100, half) - 50) < 1e-6);
});

test("decay is a no-op for non-positive elapsed time", () => {
  assert.equal(decay(100, 0), 100);
  assert.equal(decay(100, -5), 100);
});

test("recency can lift a fresh small query over a stale big one; count never does", () => {
  const stale = { count: 1000, recent: 0 };
  const fresh = { count: 10, recent: 50 };

  // count mode: raw popularity wins, always.
  assert.ok(scoreFor("count", stale.count, stale.recent) > scoreFor("count", fresh.count, fresh.recent));

  // recency mode: the fresh burst out-scores the stale giant.
  assert.ok(scoreFor("recency", fresh.count, fresh.recent) > scoreFor("recency", stale.count, stale.recent));
});
