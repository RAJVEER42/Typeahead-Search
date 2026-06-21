// The four instruments to the right of the ring. All read /metrics (polled in
// App), animate value changes, and show steady "—" before data — never
// spinners, never NaN — mirroring the backend's degrade-don't-fail stance.

import { useEffect, useRef } from "react";
import type { Metrics } from "../lib/api";
import { useCountUp } from "../lib/hooks";

const BUDGET_MS = 5; // p95 latency budget line

// --- svg arc helpers ---
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [sx, sy] = polar(cx, cy, r, endDeg);
  const [ex, ey] = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 0 ${ex} ${ey}`;
}

/** Effective hit rate spans both cache layers; the server's redis-only figure
 * understates it because L1 absorbs the hottest prefixes. */
export function HitRateGauge({ m }: { m: Metrics | null }) {
  const served = m ? m.l1Hits + m.cacheHits + m.cacheMisses : 0;
  const rate = m && served > 0 ? ((m.l1Hits + m.cacheHits) / served) * 100 : 0;
  const animated = useCountUp(rate);
  const sweep = 270;
  // 270° arc, opening at the bottom: 135° -> 405°.
  const valueEnd = 135 + sweep * (animated / 100);
  const color = rate >= 90 ? "#1f7a3d" : rate >= 70 ? "#1a1a17" : "#ff4d00";

  return (
    <section className="tile gauge" data-kind="hit">
      <div className="tile-head">
        <span className="eyebrow">cache hit rate</span>
        <span className="corner">effective</span>
      </div>
      <div className="dial">
        <svg width="132" height="116" viewBox="0 0 132 116" aria-hidden>
          <defs>
            <linearGradient id="hitgrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1a1a17" />
              <stop offset="100%" stopColor="#ff4d00" />
            </linearGradient>
          </defs>
          <path d={arcPath(66, 60, 48, 135, 405)} stroke="#d8d3c6" strokeWidth="9" fill="none" strokeLinecap="butt" />
          {m && served > 0 && (
            <path
              d={arcPath(66, 60, 48, 135, valueEnd)}
              stroke="url(#hitgrad)"
              strokeWidth="9"
              fill="none"
              strokeLinecap="butt"
            />
          )}
        </svg>
        <div className="dial-value">
          <span className="v" style={{ color }}>
            {m && served > 0 ? animated.toFixed(1) : "—"}
          </span>
          {m && served > 0 && <span className="u">%</span>}
        </div>
      </div>
      <span className="subline">
        {m ? `L1 ${m.l1Hits} · REDIS ${m.cacheHits} · MISS ${m.cacheMisses}` : "telemetry offline"}
      </span>
    </section>
  );
}

/** Rolling p95 with a dotted budget line, so a tail spike pokes above budget
 * instead of hiding inside one number. */
export function LatencySparkline({ m, history }: { m: Metrics | null; history: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const r = wrap.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const W = r.width;
    const H = 64;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (history.length === 0) return;

    const max = Math.max(BUDGET_MS * 1.2, ...history) || 1;
    const y = (v: number): number => H - 4 - (v / max) * (H - 10);
    const x = (i: number): number => (history.length === 1 ? W / 2 : (i / (history.length - 1)) * W);

    // budget line
    ctx.strokeStyle = "#ff4d00";
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y(BUDGET_MS));
    ctx.lineTo(W, y(BUDGET_MS));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // area + line
    ctx.beginPath();
    history.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    const line = new Path2D();
    history.forEach((v, i) => (i === 0 ? line.moveTo(x(i), y(v)) : line.lineTo(x(i), y(v))));
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fillStyle = "rgba(26,26,23,0.07)";
    ctx.fill();
    ctx.strokeStyle = "#1a1a17";
    ctx.lineWidth = 1.5;
    ctx.stroke(line);

    // leading dot
    const last = history[history.length - 1]!;
    ctx.fillStyle = last > BUDGET_MS ? "#d62828" : "#ff4d00";
    ctx.beginPath();
    ctx.arc(x(history.length - 1), y(last), 3, 0, Math.PI * 2);
    ctx.fill();
  }, [history]);

  const cur = m?.suggestLatencyMs.p95 ?? null;
  const color = cur === null ? "#76726a" : cur <= BUDGET_MS ? "#1a1a17" : cur <= BUDGET_MS * 3 ? "#ff4d00" : "#d62828";

  return (
    <section className="tile gauge" data-kind="p95">
      <div className="tile-head">
        <span className="eyebrow">suggest p95</span>
        <span className="corner">ms · budget {BUDGET_MS}</span>
      </div>
      <div className="metric-big" style={{ color }}>
        {cur === null ? "—" : cur.toFixed(3)}
        <span className="u" style={{ fontSize: 12, color: "var(--muted)" }}>
          {" "}
          ms
        </span>
      </div>
      <div ref={wrapRef} style={{ width: "100%" }}>
        <canvas ref={canvasRef} className="spark" />
      </div>
      <span className="subline">
        {m ? `p50 ${m.suggestLatencyMs.p50} · p99 ${m.suggestLatencyMs.p99}` : "telemetry offline"}
      </span>
    </section>
  );
}

export function WriteReductionGauge({ m }: { m: Metrics | null }) {
  const factor = m?.writeReductionFactor ?? null;
  const searches = m?.searchesReceived ?? 0;
  const rows = m?.dbWrites ?? 0;
  const sliver = searches > 0 ? Math.max(2, (rows / searches) * 100) : 0;
  return (
    <section className="tile gauge" data-kind="writes">
      <div className="tile-head">
        <span className="eyebrow">write reduction</span>
        <span className="corner">batching</span>
      </div>
      <div className="metric-big" style={{ color: "var(--accent-2)" }}>
        {factor === null ? "—" : `${factor.toFixed(1)}×`}
      </div>
      {factor === null ? (
        <span className="subline">awaiting first flush — submit searches</span>
      ) : (
        <>
          <div className="bar2">
            <span className="fill" style={{ width: `${100 - sliver}%` }} />
            <span className="sliver" style={{ width: `${sliver}%` }} />
          </div>
          <span className="subline">
            {searches.toLocaleString()} searches → {rows.toLocaleString()} rows
          </span>
        </>
      )}
    </section>
  );
}

export function WalDepthGauge({ m }: { m: Metrics | null }) {
  const CELLS = 16;
  const CAP = 200;
  const pending = m?.walPending ?? 0;
  const frac = Math.min(1, pending / CAP);
  const on = m ? (pending === 0 ? 0 : Math.max(1, Math.round(frac * CELLS))) : 0;
  const level = frac > 0.85 ? "danger" : frac > 0.6 ? "warn" : "";
  return (
    <section className="tile gauge" data-kind="wal">
      <div className="tile-head">
        <span className="eyebrow">wal depth</span>
        <span className="corner">write-behind</span>
      </div>
      <div className="metric-big">{m ? (pending === 0 ? "DRAINED" : `${pending}`) : "—"}</div>
      <div className={`meter ${level}`}>
        {Array.from({ length: CELLS }, (_, i) => {
          const cls =
            m && pending === 0 && i === 0
              ? "cell drained"
              : i < on
                ? `cell on${i === on - 1 ? " tip" : ""}`
                : "cell";
          return <span key={i} className={cls} />;
        })}
      </div>
      <span className="subline">{m ? `${pending} pending · cap ${CAP}` : "telemetry offline"}</span>
    </section>
  );
}
