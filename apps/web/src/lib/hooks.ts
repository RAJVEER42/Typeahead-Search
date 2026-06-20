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
