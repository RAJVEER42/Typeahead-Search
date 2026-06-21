// The command bar. Debounced suggestions, one in-flight request at a time
// (older ones aborted), keyboard navigation, prefix highlighting, and a dummy
// submit that feeds the write path. Each response is reported up via onRoute so
// the ring can fire its tracer to the shard that answered.

import { useEffect, useRef, useState } from "react";
import { fetchSuggest, postSearch, type Mode, type SuggestResponse } from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { SourceBadge } from "./SourceBadge";

// split a suggestion into its matched prefix head and the remaining tail.
function highlight(query: string, prefix: string) {
  if (!prefix || !query.startsWith(prefix)) return <>{query}</>;
  return (
    <>
      <span className="hl">{query.slice(0, prefix.length)}</span>
      {query.slice(prefix.length)}
    </>
  );
}

export function SearchPanel({
  mode,
  seed,
  seedTick,
  initialText = "",
  onActivity,
  onRoute,
}: {
  mode: Mode;
  seed: string;
  seedTick: number;
  initialText?: string;
  onActivity: () => void;
  onRoute: (resp: SuggestResponse) => void;
}) {
  const [text, setText] = useState(initialText);
  const [resp, setResp] = useState<SuggestResponse | null>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebouncedValue(text, 120);
  const abortRef = useRef<AbortController | null>(null);
  const submittedRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (seed) {
      setText(seed);
      submittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedTick]);

  useEffect(() => {
    const q = debounced.trim();
    if (!q) {
      setResp(null);
      setOpen(false);
      return;
    }
    if (submittedRef.current) {
      submittedRef.current = false;
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    fetchSuggest(q, mode, ac.signal)
      .then((r) => {
        setResp(r);
        setOpen(r.suggestions.length > 0);
        setActive(-1);
        setError(null);
        onRoute(r); // tell the ring which shard answered
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") {
          setError("Backend unreachable — is the server running?");
          setOpen(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, mode]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const submit = (q: string): void => {
    const query = q.trim();
    if (!query) return;
    void postSearch(query);
    setText(query);
    submittedRef.current = true;
    setOpen(false);
    setActive(-1);
    onActivity();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const items = resp?.suggestions ?? [];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit(active >= 0 && items[active] ? items[active]!.query : text);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <section className="search" ref={boxRef}>
      <div className="search-row">
        <div className="cmd">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path
              d="M21 21l-4.3-4.3M11 18a7 7 0 110-14 7 7 0 010 14z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            autoFocus
            value={text}
            placeholder="Search… try “ip”, “red”, “how to”"
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => resp && resp.suggestions.length > 0 && setOpen(true)}
            onKeyDown={onKeyDown}
            aria-label="search"
          />
          {resp && resp.source !== "empty" && (
            <SourceBadge source={resp.source} node={resp.node} tookMs={resp.tookMs} />
          )}
        </div>
        <button className="go" onClick={() => submit(text)}>
          Search
        </button>
      </div>

      {open && resp && resp.suggestions.length > 0 && (
        <ul className="dropdown" role="listbox">
          {resp.suggestions.map((s, i) => (
            <li
              key={s.query}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                submit(s.query);
              }}
            >
              <span className="opt-query">{highlight(s.query, resp.prefix)}</span>
              <span className="opt-count num">{s.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="status error">{error}</p>}
    </section>
  );
}
