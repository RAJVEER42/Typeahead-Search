// Builds the Fastify instance and mounts every route. Kept separate from boot
// (index.ts) so tests could spin up an app against fakes without a real server.

import Fastify, { type FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";
import { registerHealth } from "./routes/health.js";
import { registerSuggest } from "./routes/suggest.js";
import { registerSearch } from "./routes/search.js";
import { registerTrending } from "./routes/trending.js";
import { registerMetrics } from "./routes/metrics.js";
import { registerCache } from "./routes/cache.js";

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({ logger: false });

  // permissive CORS for local dev: web on :5173 calling the api on :8080.
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "content-type");
  });
  app.options("/*", async (_req, reply) => reply.code(204).send());

  registerHealth(app, ctx);
  registerSuggest(app, ctx);
  registerSearch(app, ctx);
  registerTrending(app, ctx);
  registerMetrics(app, ctx);
  registerCache(app, ctx);

  return app;
}
