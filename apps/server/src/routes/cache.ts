// Cache observability — the endpoints that make consistent hashing visible.
//   GET /cache/debug?prefix=<p>&mode=  -> which shard owns this prefix + hit/miss
//   GET /cache/ring?sample=<n>         -> key distribution across the shards

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import type { Mode } from "../types.js";

const ALPHA = "abcdefghijklmnopqrstuvwxyz";

// synthesize n short keys to show how the ring spreads prefixes across shards.
function sampleKeys(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < ALPHA.length && out.length < n; i++) {
    for (let j = 0; j < ALPHA.length && out.length < n; j++) {
      for (let k = 0; k < ALPHA.length && out.length < n; k++) {
        out.push(`sugg:count:${ALPHA[i]}${ALPHA[j]}${ALPHA[k]}`);
      }
    }
  }
  return out;
}

export function registerCache(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { prefix?: string; mode?: string } }>(
    "/cache/debug",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            prefix: { type: "string" },
            mode: { type: "string" }, // unknown mode -> defaults to count
          },
        },
      },
    },
    async (req) => {
      const prefix = (req.query.prefix ?? "").toLowerCase().trim();
      const mode: Mode = req.query.mode === "recency" ? "recency" : "count";
      const { ring, cached } = await ctx.cache.probe(prefix, mode);
      return {
        prefix,
        mode,
        redisKey: ring.key,
        ownerNode: ring.ownerNode,
        keyHash: ring.keyHash,
        ringPosition: ring.ringPosition,
        wrappedAround: ring.wrappedAround,
        totalVnodes: ring.totalVnodes,
        cached,
        status: cached ? "HIT" : "MISS",
      };
    },
  );

  app.get<{ Querystring: { sample?: number } }>(
    "/cache/ring",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { sample: { type: "integer", minimum: 1, maximum: 17576 } },
        },
      },
    },
    async (req) => {
      const sample = req.query.sample ?? 5000;
      const distribution = ctx.cache.ringDistribution(sampleKeys(sample));
      return { sample, nodes: ctx.cache.nodes, distribution };
    },
  );
}
