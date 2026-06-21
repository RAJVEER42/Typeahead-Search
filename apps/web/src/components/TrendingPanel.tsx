// The decaying leaderboard. Polls /trending and draws each entry's score as a
// bar relative to the top. Refreshes the instant a search is submitted.

import { fetchTrending } from "../lib/api";
import { usePoll } from "../lib/hooks";

export function TrendingPanel({ refreshKey, onPick }: { refreshKey: number; onPick: (q: string) => void }) {
  const trending = usePoll(() => fetchTrending(8), 2500, refreshKey) ?? [];
  const max = trending.reduce((m, t) => Math.max(m, t.score), 0) || 1;

  return (
    <section className="tile" data-kind="trending">
      <div className="trend-head">
        <span className="dot" />
        <span className="eyebrow">trending now</span>
      </div>
      {trending.length === 0 ? (
        <p className="empty">Submit a few searches to warm up the leaderboard.</p>
      ) : (
        <ol className="trend-list">
          {trending.map((t, i) => (
            <li key={t.query} onClick={() => onPick(t.query)} tabIndex={0}>
              <span className="rank num">{String(i + 1).padStart(2, "0")}</span>
              <span className="trend-q">{t.query}</span>
              <span className="trend-bar" style={{ width: `${(t.score / max) * 100}%` }} />
              <span className="trend-score num">{t.score.toFixed(1)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
