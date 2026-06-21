// The consistent-hash ring, rendered to canvas. Three shard nodes sit at fixed
// angles with ownership arcs sized from the live /cache/ring distribution (so
// "load spreads evenly" is drawn, not claimed). Each /suggest response fires
// one tracer that reveals the real cache path:
//   redis -> a bright comet from the L1 core out to the owning shard
//   trie  -> the same comet, dimmed + dashed, to the would-be owner + a chip
//   l1    -> no comet; the central L1 hex pulses (served before the ring)
// The search itself works with no canvas — this is progressive enhancement.

import { useEffect, useRef, useState } from "react";
import type { RingDistribution } from "../lib/api";
import type { Source } from "../lib/api";

export interface RouteInfo {
  source: Source;
  node?: string;
  seq: number; // bumps on every response so identical routes still re-fire
}

const ANGLE: Record<string, number> = { "7070": -90, "7071": 30, "7072": 150 };
// risograph triad: ink, international orange, blue — matches the CSS tokens.
const COLOR: Record<string, string> = { "7070": "#1a1a17", "7071": "#ff4d00", "7072": "#2b4fe0" };
const C = {
  track: "#bdb7a8",
  tick: "#76726a",
  ink: "#1a1a17",
  orange: "#ff4d00",
};
const FONT = "Helvetica, Arial, sans-serif";

interface Pulse {
  kind: "redis" | "trie" | "l1";
  port?: string;
  start: number;
}

const portOf = (node?: string): string | undefined => node?.split(":")[1];

export function RingViz({ distribution, route }: { distribution: RingDistribution; route: RouteInfo }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef<Pulse | null>(null);
  const distRef = useRef(distribution);
  distRef.current = distribution;
  const [trieChip, setTrieChip] = useState(false);

  // fire a tracer whenever a new response lands.
  useEffect(() => {
    if (route.seq === 0) return;
    const port = portOf(route.node);
    if (route.source === "l1") pulseRef.current = { kind: "l1", start: performance.now() };
    else if (port && port in ANGLE) {
      pulseRef.current = { kind: route.source === "trie" ? "trie" : "redis", port, start: performance.now() };
    }
    if (route.source === "trie") {
      setTrieChip(true);
      const id = setTimeout(() => setTrieChip(false), 1400);
      return () => clearTimeout(id);
    }
    return;
  }, [route.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let W = 0;
    let H = 0;

    const resize = (): void => {
      const r = wrap.getBoundingClientRect();
      W = r.width;
      H = r.height;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
    const pos = (cx: number, cy: number, R: number, deg: number): [number, number] => {
      const a = (deg * Math.PI) / 180;
      return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
    };

    const draw = (now: number): void => {
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R = (Math.min(W, H) / 2) * 0.72;
      if (R <= 0) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dist = distRef.current;
      const ports = Object.keys(ANGLE);
      const total = ports.reduce((s, p) => s + (dist[`localhost:${p}`] ?? 0), 0) || ports.length;
      const share = (p: string): number => (dist[`localhost:${p}`] ?? total / ports.length) / total;
      const pulse = pulseRef.current;
      const elapsed = pulse ? now - pulse.start : Infinity;
      if (pulse && elapsed > 1600) pulseRef.current = null;

      // 2^32 hash track — a drafting hairline, no glow
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // bezel ticks
      for (let i = 0; i < 36; i++) {
        const major = i % 3 === 0;
        const [x1, y1] = pos(cx, cy, R - (major ? 8 : 4), i * 10);
        const [x2, y2] = pos(cx, cy, R - 1, i * 10);
        ctx.strokeStyle = major ? C.ink : C.track;
        ctx.lineWidth = major ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.fillStyle = C.tick;
      ctx.font = `9px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const [deg, label] of [[0, "0"], [90, "2³⁰"], [180, "2³¹"], [270, "3·2²⁹"]] as const) {
        const [lx, ly] = pos(cx, cy, R - 20, deg);
        ctx.fillText(label, lx, ly);
      }

      // ownership arcs (sized by live distribution), centered on each node
      for (const p of ports) {
        const a = (ANGLE[p]! * Math.PI) / 180;
        const w = share(p) * Math.PI * 2;
        const bright = pulse?.port === p && pulse.kind === "redis" && elapsed < 900;
        ctx.strokeStyle = COLOR[p]!;
        ctx.globalAlpha = bright ? 0.9 : 0.32;
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(cx, cy, R, a - w / 2, a + w / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // idle radar sweep
      if (!reduce) {
        const sweep = ((now / 8000) % 1) * Math.PI * 2 - Math.PI / 2;
        const [sx, sy] = pos(cx, cy, R - 2, (sweep * 180) / Math.PI);
        const grad = ctx.createLinearGradient(cx, cy, sx, sy);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(1, "rgba(26,26,23,0.12)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      // shard nodes
      for (let i = 0; i < ports.length; i++) {
        const p = ports[i]!;
        const [nx, ny] = pos(cx, cy, R, ANGLE[p]!);
        const breathe = reduce ? 0 : 0.2 * Math.sin(now / 1250 + i);
        let r = 6 + share(p) * 12;
        const active = pulse?.port === p;
        // arrival halo
        if (active && pulse) {
          const ht = (elapsed - 450) / 600;
          if (ht > 0 && ht < 1) {
            ctx.strokeStyle = COLOR[p]!;
            ctx.globalAlpha = 0.9 * (1 - ht);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(nx, ny, r + ht * 26, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            r *= 1 + 0.6 * (1 - ht);
          }
        }
        ctx.fillStyle = COLOR[p]!;
        ctx.globalAlpha = 0.35 + breathe;
        ctx.beginPath();
        ctx.arc(nx, ny, r + 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.fill();
        // port label outside the track
        const [lx, ly] = pos(cx, cy, R + 16, ANGLE[p]!);
        ctx.fillStyle = active && elapsed < 900 ? COLOR[p]! : C.tick;
        ctx.font = `bold 10px ${FONT}`;
        ctx.fillText(`:${p}`, lx, ly);
      }

      // L1 hex core
      const l1Active = pulse?.kind === "l1" && elapsed < 600;
      const hexR = 13 + (l1Active ? 6 * (1 - elapsed / 600) : 0);
      ctx.strokeStyle = l1Active ? C.orange : C.ink;
      ctx.globalAlpha = l1Active ? 1 : 0.85;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const x = cx + hexR * Math.cos(a);
        const y = cy + hexR * Math.sin(a);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      if (l1Active) {
        ctx.globalAlpha = 1 - elapsed / 600;
        ctx.beginPath();
        ctx.arc(cx, cy, hexR + 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = l1Active ? C.orange : C.ink;
      ctx.font = `bold 9px ${FONT}`;
      ctx.fillText("L1", cx, cy);

      // routed-key comet (redis / trie)
      if (pulse && pulse.kind !== "l1" && pulse.port) {
        const t = Math.min(1, elapsed / 450);
        const [nx, ny] = pos(cx, cy, R, ANGLE[pulse.port]!);
        const e = easeOut(t);
        const px = cx + (nx - cx) * e;
        const py = cy + (ny - cy) * e;
        const dim = pulse.kind === "trie";
        ctx.strokeStyle = dim ? C.orange : COLOR[pulse.port]!;
        ctx.globalAlpha = dim ? 0.7 : 1;
        ctx.lineWidth = dim ? 1.5 : 2.5;
        if (dim) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx + (nx - cx) * Math.max(0, e - 0.18), cy + (ny - cy) * Math.max(0, e - 0.18));
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);
        if (!dim) {
          ctx.fillStyle = COLOR[pulse.port]!;
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="ring-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="consistent-hash ring" />
      {trieChip && <span className="trie-chip">▲ TRIE FALLBACK</span>}
    </div>
  );
}
