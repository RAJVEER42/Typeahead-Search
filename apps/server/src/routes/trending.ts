// GET /trending?n=10
// The decaying leaderboard — recently hot queries, not all-time popular ones.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

const schema = {
  querystring: {
    type: "object",
    properties: { n: { type: "integer", minimum: 1, maximum: 50 } },
  },
};

export function registerTrending(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { n?: number } }>("/trending", { schema }, async (req) => {
    const n = req.query.n ?? 10;
    return { trending: await ctx.trending.top(n) };
  });
}
