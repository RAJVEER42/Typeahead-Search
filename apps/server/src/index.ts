// Boot. Wire the singletons, wait for infra, build the trie from postgres,
// start the background timers, then serve. Shutdown drains the write buffer so
// the last un-flushed window is not lost.

import { config } from "./config.js";
import { CompletionTrie } from "./lib/trie.js";
import { CacheCluster } from "./lib/cache.js";
import { Store } from "./lib/store.js";
import { Trending } from "./lib/trending.js";
import { WriteBuffer } from "./lib/writeBuffer.js";
import { buildApp } from "./app.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// retry an async check until it passes — infra often boots a beat after us.
async function waitFor(name: string, fn: () => Promise<unknown>, attempts = 30): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`waiting for ${name}... (${i}/${attempts})`);
      await sleep(1000);
    }
  }
}

async function main(): Promise<void> {
  const store = new Store();
  const cache = new CacheCluster();
  const trie = new CompletionTrie();

  await waitFor("postgres", () => store.ready());
  await store.initSchema();
  await waitFor("redis cluster", () => cache.ready());

  console.log("building trie from postgres...");
  const t0 = performance.now();
  trie.build(await store.loadAll());
  console.log(`trie ready: ${trie.size} queries in ${(performance.now() - t0).toFixed(0)}ms`);

  const trending = new Trending(cache);
  const buffer = new WriteBuffer(cache, store, trie, trending);
  buffer.start();
  trending.startDecay();

  const app = buildApp({ trie, cache, store, trending, buffer });
  await app.listen({ port: config.server.port, host: config.server.host });
  console.log(`listening on http://${config.server.host}:${config.server.port}`);
  console.log(`cache shards: ${cache.nodes.join(", ")}`);

  let closing = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`\n${sig} received — draining write buffer...`);
    trending.stop();
    await buffer.stop().catch(() => {}); // final flush so we don't drop the tail
    await app.close();
    await cache.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
