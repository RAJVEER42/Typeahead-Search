// The decaying leaderboard. Polls /trending and draws a score bar relative to
// the top entry. Refreshes right after a search so a submission shows up.

import { fetchTrending } from "../lib/api";
import { usePoll } from "../lib/hooks";

export function TrendingPanel({ refreshKey, onPick }: { refreshKey: number; onPick: (q: string) => void }) {
  const trending = usePoll(() => fetchTrending(8), 2500, refreshKey) ?? [];
  const max = trending.reduce((m, t) => Math.max(m, t.score), 0) || 1;

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="live-dot" />
        Trending now
      </header>
      {trending.length === 0 ? (
        <p className="empty">Submit a few searches to warm up the leaderboard.</p>
      ) : (
        <ol className="trend-list">
          {trending.map((t, i) => (
            <li key={t.query} onClick={() => onPick(t.query)}>
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="trend-query">{t.query}</span>
              <span className="trend-bar" style={{ width: `${(t.score / max) * 100}%` }} />
              <span className="trend-score">{t.score.toFixed(1)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
