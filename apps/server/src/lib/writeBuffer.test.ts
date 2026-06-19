import { test } from "node:test";
import assert from "node:assert/strict";
import { coalesce } from "./writeBuffer.js";

test("coalesce sums repeated queries into a single count", () => {
  const m = coalesce(["iphone", "ipad", "iphone", "iphone", "ipad"]);
  assert.equal(m.get("iphone"), 3);
  assert.equal(m.get("ipad"), 2);
  assert.equal(m.size, 2);
});

test("coalesce of an empty batch is an empty map", () => {
  assert.equal(coalesce([]).size, 0);
});
