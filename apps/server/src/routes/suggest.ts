// GET /suggest?q=<prefix>&mode=count|recency
// The hot path. Cache-aside over the ring, falling back to the trie. Postgres
// is never touched here. Returns up to TOP_K prefix matches plus the source it
// was served from, so the UI can show the cache routing live.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { config } from "../config.js";
import { recordLatency } from "../lib/metrics.js";
import type { Mode, Source, SuggestResponse } from "../types.js";

const schema = {
  querystring: {
    type: "object",
    properties: {
      q: { type: "string" },
      // not an enum on purpose: an unknown mode defaults to "count" in the
      // handler rather than 400-ing, so the endpoint stays forgiving.
      mode: { type: "string" },
    },
  },
};

export function registerSuggest(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { q?: string; mode?: string } }>(
    "/suggest",
    { schema },
    async (req): Promise<SuggestResponse> => {
      const started = performance.now();
      // normalize: case-insensitive, trimmed; default to count ranking.
      const prefix = (req.query.q ?? "").toLowerCase().trim();
      const mode: Mode = req.query.mode === "recency" ? "recency" : "count";

      if (!prefix) {
        return { prefix, mode, source: "empty", suggestions: [] };
      }

      let source: Source;
      let suggestions;

      const cached = await ctx.cache.getSuggestions(prefix, mode);
      if (cached.hit) {
        source = cached.source!; // "l1" | "redis"
        suggestions = cached.value!;
      } else {
        // cache miss -> serve from the in-memory trie, then backfill the cache.
        suggestions = ctx.trie.getSuggestions(prefix, config.ranking.topK, mode);
        await ctx.cache.setSuggestions(prefix, mode, suggestions);
        source = "trie";
      }

      const tookMs = Number((performance.now() - started).toFixed(3));
      recordLatency(tookMs);
      return { prefix, mode, source, node: cached.node, suggestions, tookMs };
    },
  );
}
