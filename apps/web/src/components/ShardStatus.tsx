// One row per redis shard: port, key-ownership bar (from /cache/ring), session
// reads this client routed there, and a health dot. Fixed shard colors tie it
// back to the ring and the source badge.

import type { RingDistribution } from "../lib/api";

const PORTS = ["7070", "7071", "7072"] as const;
const COLOR: Record<string, string> = { "7070": "var(--shard-7070)", "7071": "var(--shard-7071)", "7072": "var(--shard-7072)" };

export function ShardStatus({ distribution, hits }: { distribution: RingDistribution; hits: Record<string, number> }) {
  const total = PORTS.reduce((s, p) => s + (distribution[`localhost:${p}`] ?? 0), 0) || 1;
  return (
    <section className="tile" data-kind="shards">
      <div className="tile-head">
        <span className="eyebrow">shard status</span>
        <span className="corner">3 nodes · 160 vnodes</span>
      </div>
      {PORTS.map((p) => {
        const share = ((distribution[`localhost:${p}`] ?? 0) / total) * 100;
        return (
          <div className="shard-row" key={p}>
            <span className="shard-port" style={{ color: COLOR[p] }}>
              :{p}
            </span>
            <span className="shard-bar">
              <span className="fill" style={{ width: `${share || 33}%`, background: COLOR[p] }} />
            </span>
            <span className="shard-hits">{(hits[p] ?? 0).toLocaleString()}</span>
            <span className="health" />
          </div>
        );
      })}
    </section>
  );
}
