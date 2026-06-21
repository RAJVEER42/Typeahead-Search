// Renders where the last suggestion response came from — the live view of the
// cache path (L1 -> redis -> trie) and which shard answered.

import type { Source } from "../lib/api";

const LABELS: Record<Source, string> = {
  l1: "L1 in-process",
  redis: "Redis",
  trie: "Trie (cache miss)",
  empty: "",
};

export function SourceBadge({
  source,
  node,
  tookMs,
}: {
  source: Source;
  node?: string;
  tookMs?: number;
}) {
  if (source === "empty") return null;
  const port = node?.split(":")[1];
  return (
    <div className={`badge badge-${source}`}>
      <span className="badge-dot" />
      {LABELS[source]}
      {source !== "l1" && port && <span className="badge-node">shard :{port}</span>}
      {typeof tookMs === "number" && <span className="badge-took">{tookMs.toFixed(3)} ms</span>}
    </div>
  );
}
