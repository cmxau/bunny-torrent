import { useMemo } from "react";
import { hostOf, type Snapshot } from "./api";
import { KINDS, matchStatus, NO_FILTER, STATUSES, type Filter } from "./filters";

/** Number of filter dimensions that are currently narrowing the list. */
export const activeFilterCount = (f: Filter) =>
  [f.status !== "all", f.kind !== null, f.category !== null, f.tag !== null, f.tracker !== null].filter(Boolean).length;

export function FilterMenu({
  snap,
  filter,
  setFilter,
  x,
  y,
  onClose,
}: {
  snap: Snapshot;
  filter: Filter;
  setFilter: (f: Filter) => void;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const torrents = snap.torrents;
  const hosts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of torrents) for (const h of new Set(t.trackers.map(hostOf))) m.set(h, (m.get(h) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [torrents]);

  const row = (label: string, count: number, active: boolean, onClick: () => void, key = label) => (
    <button key={key} className={`frow ${active ? "on" : ""}`} onClick={onClick} aria-pressed={active}>
      <span className="tick">{active ? "✓" : ""}</span>
      <span className="lbl">{label}</span>
      <em>{count}</em>
    </button>
  );
  const catCount = (c: string) => torrents.filter((t) => (t.category ?? "") === c).length;
  const tagCount = (g: string) => torrents.filter((t) => (g === "" ? t.tags.length === 0 : t.tags.includes(g))).length;
  const n = activeFilterCount(filter);

  return (
    <div className="menubg" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        className="ctx fmenu"
        style={{ left: Math.max(8, Math.min(x, window.innerWidth - 700)), top: Math.max(8, y) }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Filter torrents"
      >
        <div className="fcols">
          <div className="fcol">
            <small>Status</small>
            {STATUSES.map((s) =>
              row(
                s.label,
                torrents.filter((t) => matchStatus(t, s.key)).length,
                filter.status === s.key,
                () => setFilter({ ...filter, status: s.key }),
                s.key,
              ),
            )}
          </div>
          <div className="fcol">
            <small>Type</small>
            {row("All", torrents.length, filter.kind === null, () => setFilter({ ...filter, kind: null }), "k-all")}
            {KINDS.map((k) =>
              row(k.label, torrents.filter((t) => t.kind === k.key).length, filter.kind === k.key, () =>
                setFilter({ ...filter, kind: k.key }),
              ),
            )}
            <small>Category</small>
            {row("All", torrents.length, filter.category === null, () => setFilter({ ...filter, category: null }), "c-all")}
            {row("Uncategorised", catCount(""), filter.category === "", () => setFilter({ ...filter, category: "" }), "c-none")}
            {snap.categories.map((c) =>
              row(c.name, catCount(c.name), filter.category === c.name, () => setFilter({ ...filter, category: c.name }), `c-${c.name}`),
            )}
          </div>
          <div className="fcol">
            <small>Tag</small>
            {row("All", torrents.length, filter.tag === null, () => setFilter({ ...filter, tag: null }), "t-all")}
            {row("Untagged", tagCount(""), filter.tag === "", () => setFilter({ ...filter, tag: "" }), "t-none")}
            {snap.tags.map((g) => row(g, tagCount(g), filter.tag === g, () => setFilter({ ...filter, tag: g }), `t-${g}`))}
            <small>Tracker</small>
            {row("All", torrents.length, filter.tracker === null, () => setFilter({ ...filter, tracker: null }), "r-all")}
            {row("Trackerless", torrents.filter((t) => t.trackers.length === 0).length, filter.tracker === "", () => setFilter({ ...filter, tracker: "" }), "r-none")}
            {hosts.map(([h, c]) => row(h, c, filter.tracker === h, () => setFilter({ ...filter, tracker: h }), `r-${h}`))}
          </div>
        </div>
        <div className="ffoot">
          <button className="lnk" disabled={n === 0} onClick={() => setFilter(NO_FILTER)}>
            Clear filters
          </button>
          <span className="grow" />
          <button className="ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
