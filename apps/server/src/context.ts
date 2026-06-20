// The wired-up singletons every route needs. Built once at boot in index.ts
// and handed to each route registrar.

import type { CompletionTrie } from "./lib/trie.js";
import type { CacheCluster } from "./lib/cache.js";
import type { Store } from "./lib/store.js";
import type { Trending } from "./lib/trending.js";
import type { WriteBuffer } from "./lib/writeBuffer.js";

export interface AppContext {
  trie: CompletionTrie;
  cache: CacheCluster;
  store: Store;
  trending: Trending;
  buffer: WriteBuffer;
}
