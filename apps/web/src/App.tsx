import { useEffect, useState } from "react";
import { SearchPanel } from "./components/SearchPanel";
import { ModeToggle } from "./components/ModeToggle";
import { RingViz, type RouteInfo } from "./components/RingViz";
import { HitRateGauge, LatencySparkline, WriteReductionGauge, WalDepthGauge } from "./components/Gauges";
import { TrendingPanel } from "./components/TrendingPanel";
import { ShardStatus } from "./components/ShardStatus";
import { fetchMetrics, fetchRing, type Mode, type SuggestResponse } from "./lib/api";
import { usePoll } from "./lib/hooks";
import "./styles.css";

const PORTS = ["7070", "7071", "7072"] as const;
const COLOR: Record<string, string> = { "7070": "var(--shard-7070)", "7071": "var(--shard-7071)", "7072": "var(--shard-7072)" };
const compact = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

export default function App() {
  const [mode, setMode] = useState<Mode>("count");
  const [refreshKey, setRefreshKey] = useState(0);
  const [picked, setPicked] = useState({ q: "", tick: 0 });
  const [route, setRoute] = useState<RouteInfo>({ source: "empty", seq: 0 });
  const [shardHits, setShardHits] = useState<Record<string, number>>({});
  const [p95History, setP95History] = useState<number[]>([]);

  const metrics = usePoll(fetchMetrics, 2500, refreshKey);
  const dist = usePoll(() => fetchRing(5000), 20000, 0) ?? {};

  // grow the latency sparkline from each metrics poll.
  useEffect(() => {
    if (metrics) setP95History((h) => [...h, metrics.suggestLatencyMs.p95].slice(-40));
  }, [metrics]);

  // fire the ring tracer + tally the shard each lookup routed to.
  const handleRoute = (resp: SuggestResponse): void => {
    setRoute((prev) => ({ source: resp.source, node: resp.node, seq: prev.seq + 1 }));
    const port = resp.node?.split(":")[1];
    if ((resp.source === "redis" || resp.source === "trie") && port) {
      setShardHits((h) => ({ ...h, [port]: (h[port] ?? 0) + 1 }));
    }
  };

  // one masthead LED resolves to the worst current condition.
  const led = !metrics
    ? "warn"
    : metrics.cacheErrors > 0
      ? "fault"
      : route.source === "trie" || metrics.walPending > 120
        ? "warn"
        : "ok";

  const total = PORTS.reduce((s, p) => s + (dist[`localhost:${p}`] ?? 0), 0) || 1;

  return (
    <div className="console">
      <header className="masthead">
        <div className="callsign">
          <span className="dot" />
          Typeahead <span className="tag">Search Engine</span>
          <span className="led" data-state={led} aria-label={`status ${led}`} />
        </div>
        <div className="masthead-right">
          <ModeToggle mode={mode} onChange={setMode} />
          <span className="conn" data-up={String(!!metrics)}>
            <span className="dot" />
            {metrics ? "connected" : "offline"}
          </span>
        </div>
      </header>

      <SearchPanel
        mode={mode}
        seed={picked.q}
        seedTick={picked.tick}
        initialText={new URLSearchParams(window.location.search).get("q") ?? ""}
        onActivity={() => setRefreshKey((k) => k + 1)}
        onRoute={handleRoute}
      />

      <div className="grid">
        <section className="tile" data-kind="ring">
          <div className="tile-head">
            <span className="eyebrow">consistent-hash ring</span>
            <span className="corner">{metrics ? `${compact(metrics.trieSize)} indexed` : "—"}</span>
          </div>
          <RingViz distribution={dist} route={route} />
          <div className="legend">
            {PORTS.map((p) => {
              const share = (((dist[`localhost:${p}`] ?? 0) / total) * 100).toFixed(0);
              return (
                <span className="legend-chip" key={p}>
                  <span className="sw" style={{ background: COLOR[p] }} />:{p}
                  <span className="num" style={{ color: "var(--muted)" }}>
                    {" "}
                    {total > PORTS.length ? `${share}%` : "—"}
                  </span>
                </span>
              );
            })}
          </div>
        </section>

        <div className="gauges">
          <HitRateGauge m={metrics} />
          <LatencySparkline m={metrics} history={p95History} />
          <WriteReductionGauge m={metrics} />
          <WalDepthGauge m={metrics} />
        </div>
      </div>

      <div className="row3">
        <TrendingPanel refreshKey={refreshKey} onPick={(q) => setPicked((p) => ({ q, tick: p.tick + 1 }))} />
        <ShardStatus distribution={dist} hits={shardHits} />
      </div>

      <footer className="footer">
        Mode <strong>{mode === "count" ? "Popularity" : "Trending"}</strong> · reads served cache → trie ·
        never the database
      </footer>
    </div>
  );
}
