import type { Torrent } from "./api";
import { needsStart, statusLabel } from "./filters";
import { Icon, P } from "./ui";
import type { Col, ColKey } from "./columns";

export type Sort = { key: ColKey; dir: 1 | -1 };

export function TorrentTable({
  torrents,
  shown,
  cols,
  sort,
  setSort,
  selected,
  onSelect,
  onMenu,
  onColMenu,
  onToggle,
  onRemove,
}: {
  /** every torrent (to tell "nothing yet" from "nothing matches") */
  torrents: Torrent[];
  shown: Torrent[];
  cols: Col[];
  sort: Sort;
  setSort: (s: Sort) => void;
  selected: number | null;
  onSelect: (id: number) => void;
  onMenu: (t: Torrent, x: number, y: number) => void;
  onColMenu: (x: number, y: number) => void;
  onToggle: (t: Torrent) => void;
  onRemove: (t: Torrent) => void;
}) {
  const gridCols = cols.map((c) => c.width).join(" ");
  // a flexible column counts at its minimum width, so the header only scrolls when it really must
  const colMin = (w: string) => (w.startsWith("minmax") ? Number(/minmax\((\d+)px/.exec(w)?.[1] ?? 160) : parseInt(w, 10) || 100);
  const minWidth = cols.reduce((a, c) => a + colMin(c.width) + 10, 32);

  return (
    <div className="table tscroll">
      <div className="tinner" style={{ minWidth }}>
        <div
          className="thead"
          style={{ gridTemplateColumns: gridCols }}
          onContextMenu={(e) => {
            e.preventDefault();
            onColMenu(e.clientX, e.clientY);
          }}
        >
          {cols.map((c) => (
            <button
              key={c.key}
              className={sort.key === c.key ? "sorted" : ""}
              onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? (sort.dir === 1 ? -1 : 1) : c.firstDir })}
              aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
            >
              {c.label}
              {sort.key === c.key && <span>{sort.dir === 1 ? " ▲" : " ▼"}</span>}
            </button>
          ))}
        </div>
        <div className="rows">
          {shown.length === 0 && (
            <div className="empty">
              {torrents.length === 0 ? (
                <>
                  <p>Nothing here yet</p>
                  <small>Drop a .torrent file anywhere, paste a magnet link, or press “Add torrent”.</small>
                </>
              ) : (
                <>
                  <p>No torrents match</p>
                  <small>Try clearing the filters or the search.</small>
                </>
              )}
            </div>
          )}
          {shown.map((t) => (
            <Row
              key={t.id}
              t={t}
              cols={cols}
              gridCols={gridCols}
              selected={t.id === selected}
              onSelect={() => onSelect(t.id)}
              onMenu={(x, y) => onMenu(t, x, y)}
              onToggle={() => onToggle(t)}
              onRemove={() => onRemove(t)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  t,
  cols,
  gridCols,
  selected,
  onSelect,
  onMenu,
  onToggle,
  onRemove,
}: {
  t: Torrent;
  cols: Col[];
  gridCols: string;
  selected: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const stopped = t.state === "stopped";
  const icon = t.state === "downloading" ? "↓" : t.state === "seeding" ? "↑" : stopped ? "⏸" : t.state === "queued" ? "⧖" : t.state === "errored" ? "!" : "…";
  const resumable = needsStart(t);
  const barCls = t.finished || t.progress >= 1 ? "ok" : stopped ? "dim" : t.state === "errored" ? "bad" : "";
  return (
    <div
      className={`row ${selected ? "sel" : ""} ${stopped && !t.finished ? "paused" : ""}`}
      style={{ gridTemplateColumns: gridCols }}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      title={t.error ?? statusLabel(t)}
    >
      {cols.map((c) => {
        if (c.key === "name")
          return (
            <span key="name" className="name">
              <i className="st">{icon}</i>
              <span className="nm">{t.name}</span>
            </span>
          );
        if (c.key === "progress")
          return (
            <span key="progress" className="prog-cell">
              <span className="prog"><b className={barCls} style={{ width: `${Math.max(2, t.progress * 100)}%` }} /></span>
              <small>{Math.floor(t.progress * 100)}%</small>
            </span>
          );
        return (
          <span key={c.key} className="cell">
            {c.cell(t)}
          </span>
        );
      })}
      <span className="acts" onClick={(e) => e.stopPropagation()}>
        <button title={resumable ? "Resume" : "Pause"} onClick={onToggle}>
          <Icon d={resumable ? P.play : P.pause} size={14} />
        </button>
        <button title="Remove" onClick={onRemove}>
          <Icon d={P.trash} size={14} />
        </button>
      </span>
    </div>
  );
}
