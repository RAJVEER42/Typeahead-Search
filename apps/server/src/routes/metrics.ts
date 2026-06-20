// GET /metrics
// Cache hit rate, suggest latency percentiles, write-reduction factor, WAL
// depth. The numbers the performance report is built from.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { snapshot } from "../lib/metrics.js";

export function registerMetrics(app: FastifyInstance, ctx: AppContext): void {
  app.get("/metrics", async () =>
    snapshot({
      trieSize: ctx.trie.size,
      walPending: await ctx.buffer.pending(),
      cacheNodes: ctx.cache.nodes,
    }),
  );
}
