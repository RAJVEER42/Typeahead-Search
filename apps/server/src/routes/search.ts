// POST /search { "query": "..." }
// The dummy search submission. It records the query (write-behind, so it
// returns immediately) and acknowledges. The count update is asynchronous and
// shows up in suggestions + trending after the next flush.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

const schema = {
  body: {
    type: "object",
    required: ["query"],
    properties: { query: { type: "string", minLength: 1, maxLength: 200 } },
  },
};

export function registerSearch(app: FastifyInstance, ctx: AppContext): void {
  app.post<{ Body: { query: string } }>("/search", { schema }, async (req, reply) => {
    const query = String(req.body?.query ?? "").trim();
    if (!query) return reply.code(400).send({ error: "query is required" });

    await ctx.buffer.record(query); // durable WAL append; flush is async
    return { message: "Searched", query };
  });
}
