// Live metrics strip. Polls /metrics and surfaces the four numbers the
// assignment asks to report: cache effectiveness, tail latency, the batching
// win, and index size. Refreshes immediately after a submitted search.

import { fetchMetrics } from "../lib/api";
import { usePoll } from "../lib/hooks";

const compact = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;

export function MetricsBar({ refreshKey }: { refreshKey: number }) {
  const m = usePoll(fetchMetrics, 2500, refreshKey);

  // effective hit rate spans both cache layers; redis-only would understate it
  // because L1 absorbs the hottest prefixes.
  const served = m ? m.l1Hits + m.cacheHits + m.cacheMisses : 0;
  const hitRate = m && served > 0 ? ((m.l1Hits + m.cacheHits) / served) * 100 : 0;

  const stats = [
    { label: "cache hit rate", value: m ? `${hitRate.toFixed(1)}%` : "—" },
    { label: "suggest p95", value: m ? `${m.suggestLatencyMs.p95} ms` : "—" },
    { label: "write reduction", value: m?.writeReductionFactor ? `${m.writeReductionFactor.toFixed(1)}×` : "—" },
    { label: "indexed queries", value: m ? compact(m.trieSize) : "—" },
  ];

  return (
    <div className="metrics">
      {stats.map((s) => (
        <div className="stat" key={s.label}>
          <div className="stat-value">{s.value}</div>
          <div className="stat-label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
