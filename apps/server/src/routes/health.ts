// GET /health — liveness + how many queries are indexed.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function registerHealth(app: FastifyInstance, ctx: AppContext): void {
  app.get("/health", async () => ({ status: "ok", trieSize: ctx.trie.size }));
}
