import { useState } from "react";
import { SearchPanel } from "./components/SearchPanel";
import { ModeToggle } from "./components/ModeToggle";
import { MetricsBar } from "./components/MetricsBar";
import { TrendingPanel } from "./components/TrendingPanel";
import type { Mode } from "./lib/api";
import "./styles.css";

export default function App() {
  const [mode, setMode] = useState<Mode>("count");
  // bumped on every submitted search so the metrics + trending panels refresh
  // immediately instead of waiting for the next poll tick.
  const [refreshKey, setRefreshKey] = useState(0);
  // a picked trending entry; the tick forces a refill even if the text repeats.
  const [picked, setPicked] = useState({ q: "", tick: 0 });

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>Typeahead Search</h1>
          <p className="tagline">
            trie serving · distributed redis cache (consistent hashing) · write-behind batching ·
            recency-aware trending
          </p>
        </div>
        <ModeToggle mode={mode} onChange={setMode} />
      </header>

      <SearchPanel
        mode={mode}
        seed={picked.q}
        seedTick={picked.tick}
        initialText={new URLSearchParams(window.location.search).get("q") ?? ""}
        onActivity={() => setRefreshKey((k) => k + 1)}
      />

      <MetricsBar refreshKey={refreshKey} />

      <TrendingPanel
        refreshKey={refreshKey}
        onPick={(q) => setPicked((p) => ({ q, tick: p.tick + 1 }))}
      />

      <footer className="foot">
        Ranking mode <strong>{mode === "count" ? "Popularity" : "Trending"}</strong> · suggestions
        served from cache → trie, never the database.
      </footer>
    </div>
  );
}
