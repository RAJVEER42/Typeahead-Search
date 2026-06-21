// Switches ranking between the 60% baseline (all-time count) and the +20%
// recency-aware blend. Same /suggest endpoint, different `mode`.

import type { Mode } from "../lib/api";

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="toggle" role="tablist" aria-label="ranking mode">
      <button
        role="tab"
        aria-selected={mode === "count"}
        className={mode === "count" ? "on" : ""}
        onClick={() => onChange("count")}
      >
        Popularity
      </button>
      <button
        role="tab"
        aria-selected={mode === "recency"}
        className={mode === "recency" ? "on" : ""}
        onClick={() => onChange("recency")}
      >
        Trending
      </button>
    </div>
  );
}
