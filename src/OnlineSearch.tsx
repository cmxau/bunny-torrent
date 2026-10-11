import { memo, useMemo, useRef, useState } from "react";
import { api, errText, fmtBytes, sourceLabel, type SearchResponse, type SearchResult } from "./api";
import { Icon, P } from "./ui";

type SortKey = "name" | "size" | "seeders" | "leechers" | "added";

const SEARCH_ICON = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3";

const dateShort = (unix: number) =>
  unix ? new Date(unix * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

const ResultRows = memo(function ResultRows({ rows, onAdd }: { rows: SearchResult[]; onAdd: (r: SearchResult) => void }) {
  return (
    <>
      {rows.map((r) => (
        <div className="rrow" key={r.id} title={r.name}>
          <span className="rname">{r.name}</span>
          <span className="rsrc">{sourceLabel(r.source)}</span>
          <span>{r.size ? fmtBytes(r.size) : "—"}</span>
          <span className={r.seeders > 0 ? "ok" : "faint"}>{r.seeders < 0 ? "—" : r.seeders}</span>
          <span className="faint">{r.leechers < 0 ? "—" : r.leechers}</span>
          <span className="faint">{dateShort(r.added)}</span>
          <button className="add small" onClick={() => onAdd(r)}>
            <Icon d={P.plus} size={13} /> Add
          </button>
        </div>
      ))}
    </>
  );
});

export function OnlineSearch({
  history,
  onAdd,
  refresh,
  flash,
  onResultsChange,
}: {
  history: string[];
  onAdd: (r: SearchResult) => void;
  refresh: () => void;
  flash: (m: string) => void;
  /** lets the page hide other panels while results are showing */
  onResultsChange: (showing: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [last, setLast] = useState("");
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [focused, setFocused] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "seeders", dir: -1 });
  const input = useRef<HTMLInputElement>(null);
  const run = useRef(0); // ignore answers from older searches

  const search = async (query: string) => {
    const text = query.trim();
    if (!text) return;
    setQ(text);
    setLast(text);
    setLoading(true);
    setResp(null);
    setFocused(false);
    onResultsChange(true);
    const mine = ++run.current;
    try {
      const r = await api.search(text);
      if (mine === run.current) setResp(r);
    } catch (e) {
      if (mine === run.current) {
        setResp({ results: [], errors: [{ source: "search", message: errText(e) }] });
        flash(errText(e));
      }
    } finally {
      if (mine === run.current) setLoading(false);
      refresh(); // pick up the new history entry
    }
  };

    const clear = () => {
    run.current++;
    setResp(null);
    setLoading(false);
    setLast("");
    onResultsChange(false);
  };

  const needle = q.trim().toLowerCase();
  const suggestions = useMemo(
    () => history.filter((h) => !needle || (h.toLowerCase().includes(needle) && h.toLowerCase() !== needle)).slice(0, 6),
    [history, needle],
  );

  const rows = useMemo(() => {
    const list = [...(resp?.results ?? [])];
    return list.sort((a, b) => {
      const x = sort.key === "name" ? a.name.toLowerCase() : a[sort.key];
      const y = sort.key === "name" ? b.name.toLowerCase() : b[sort.key];
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [resp, sort]);

  const head = (key: SortKey, label: string) => (
    <button
      className={sort.key === key ? "sorted" : ""}
      onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 })}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {label}
      {sort.key === key && <span>{sort.dir === 1 ? " ▲" : " ▼"}</span>}
    </button>
  );

  return (
    <section className="osearch" aria-label="Search torrents online">
      <form
        className="obar"
        onSubmit={(e) => {
          e.preventDefault();
          search(q);
        }}
      >
        <Icon d={SEARCH_ICON} size={18} />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search for torrents online…"
          aria-label="Search for torrents online"
          autoComplete="off"
        />
        {(resp || loading) && (
          <button type="button" className="x" onClick={clear} title="Clear results" aria-label="Clear results">
            <Icon d={P.close} size={16} />
          </button>
        )}
        <button type="submit" className="add" disabled={!q.trim() || loading}>
          {loading ? "Searching…" : "Search"}
        </button>

        {focused && suggestions.length > 0 && (
          <div className="shist" role="listbox" aria-label="Recent searches" onMouseDown={(e) => e.preventDefault()}>
            <div className="shead">
              <small>Recent searches</small>
              <button
                type="button"
                className="lnk"
                onClick={async () => {
                  await api.clearSearchHistory();
                  refresh();
                }}
              >
                Clear history
              </button>
            </div>
            {suggestions.map((h) => (
              <div key={h} className="sitem" role="option" aria-selected={false}>
                <button type="button" className="sgo" onClick={() => search(h)}>
                  <Icon d="M12 8v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" size={14} />
                  <span>{h}</span>
                </button>
                <button
                  type="button"
                  className="x"
                  aria-label={`Remove “${h}” from history`}
                  title="Remove from history"
                  onClick={async () => {
                    await api.removeSearchHistory(h);
                    refresh();
                  }}
                >
                  <Icon d={P.close} size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </form>

      {loading && (
        <div className="sstate" role="status">
          <div className="spinner" /> Searching for “{last}”…
        </div>
      )}

      {resp && !loading && (
        <div className="sresults">
          <div className="sinfo">
            <b>
              {rows.length} result{rows.length === 1 ? "" : "s"}
            </b>
            <span className="faint">for “{last}”</span>
          </div>
          {resp.errors.map((e, i) => (
            <div className="err" key={i}>
              {e.source === "search" ? "" : `${sourceLabel(e.source)}: `}
              {e.message}
              {e.source !== "search" && <span className="faint"> You can turn this source off in Settings → Search.</span>}
            </div>
          ))}
          {rows.length === 0 && resp.errors.length > 0 && (
            <div className="sstate">
              Nothing could be searched from here. Try again on a different network, or turn on another source in Settings → Search.
            </div>
          )}
          {rows.length === 0 && resp.errors.length === 0 && (
            <div className="sstate">Nothing found. Try different words, or turn on more sources in Settings → Search.</div>
          )}
          {rows.length > 0 && (
            <div className="rtable">
              <div className="rhead">
                {head("name", "NAME")}
                <span>SOURCE</span>
                {head("size", "SIZE")}
                {head("seeders", "SEEDS")}
                {head("leechers", "PEERS")}
                {head("added", "ADDED")}
                <span />
              </div>
              <div className="rbody">
                <ResultRows rows={rows} onAdd={onAdd} />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
