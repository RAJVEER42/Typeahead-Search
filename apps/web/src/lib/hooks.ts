import { useEffect, useRef, useState } from "react";

/** Returns `value` only after it has stopped changing for `delayMs` — this is
 * the debounce that keeps a keystroke from becoming a request. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Tween a number toward `target` so a metric reads like a needle moving, not a
 * text swap. Snaps instantly under prefers-reduced-motion. */
export function useCountUp(target: number, durationMs = 400): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) * (1 - t);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

/** Poll `fn` on mount, every `intervalMs`, and whenever `dep` changes. Used by
 * the metrics + trending panels so a submitted search refreshes them at once. */
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number, dep: unknown): T | null {
  const [data, setData] = useState<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    const tick = () => fnRef.current().then((d) => alive && setData(d));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs, dep]);
  return data;
}
