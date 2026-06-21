// Terminal-style status line docked in the command bar: where the last
// response was served from, which shard, and how long it took. Shard identity
// (color + port) matches the ring and the legend everywhere.

import type { Source } from "../lib/api";

export function SourceBadge({ source, node, tookMs }: { source: Source; node?: string; tookMs?: number }) {
  if (source === "empty") return null;
  const port = node?.split(":")[1];

  let cls = "is-l1";
  let label = "L1 IN-PROCESS";
  if (source === "redis") {
    cls = `is-${port}`;
    label = `REDIS :${port}`;
  } else if (source === "trie") {
    cls = "is-trie";
    label = `TRIE :${port}`;
  }

  return (
    <span className={`badge ${cls}`}>
      <span className="route-dot" />
      {label}
      {typeof tookMs === "number" && <span className="took">{tookMs.toFixed(3)} ms</span>}
    </span>
  );
}
