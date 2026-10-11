import { api, type Snapshot, type Torrent } from "./api";
import { needsStart } from "./filters";
import { COLUMNS, DEFAULT_COLS, type ColKey } from "./columns";

export type MenuPos = { x: number; y: number };

/** Right-click menu for one torrent row. */
export function TorrentMenu({
  t,
  snap,
  pos,
  close,
  act,
  askRemove,
}: {
  t: Torrent;
  snap: Snapshot;
  pos: MenuPos;
  close: () => void;
  act: (f: () => Promise<unknown>) => void;
  askRemove: (t: Torrent, files: boolean) => void;
}) {
  return (
    <div
      className="ctx"
      style={{ left: Math.min(pos.x, window.innerWidth - 230), top: Math.min(pos.y, window.innerHeight - 420) }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button onClick={() => { close(); act(() => (needsStart(t) ? api.resume([t.id]) : api.pause([t.id]))); }}>
        {needsStart(t) ? "Resume" : "Pause"}
      </button>
      {!t.finished && (
        <>
          <div className="csep" />
          <small>Queue</small>
          {([["top", "Move to top"], ["up", "Move up"], ["down", "Move down"], ["bottom", "Move to bottom"]] as const).map(([to, label]) => (
            <button key={to} onClick={() => { close(); act(() => api.queueMove([t.id], to)); }}>{label}</button>
          ))}
          <div className="csep" />
        </>
      )}
      <button onClick={() => { close(); api.openFolder(t.savePath); }}>Open folder</button>
      <div className="csep" />
      <small>Category</small>
      <button onClick={() => { close(); act(() => api.setCategory([t.id], null)); }}>
        {t.category === null ? "✓ " : ""}Uncategorised
      </button>
      {snap.categories.map((c) => (
        <button key={c.name} onClick={() => { close(); act(() => api.setCategory([t.id], c.name)); }}>
          {t.category === c.name ? "✓ " : ""}{c.name}
        </button>
      ))}
      {snap.tags.length > 0 && <small>Tags</small>}
      {snap.tags.map((g) => (
        <button
          key={g}
          onClick={() => {
            close();
            act(() => api.setTags([t.id], t.tags.includes(g) ? t.tags.filter((x) => x !== g) : [...t.tags, g]));
          }}
        >
          {t.tags.includes(g) ? "✓ " : ""}{g}
        </button>
      ))}
      <div className="csep" />
      <button onClick={() => { close(); askRemove(t, false); }}>Remove</button>
      <button className="danger" onClick={() => { close(); askRemove(t, true); }}>Remove and delete files</button>
    </div>
  );
}

/** Column picker, opened from the Columns button or by right-clicking the table header. */
export function ColumnMenu({
  pos,
  cols,
  setCols,
  close,
}: {
  pos: MenuPos;
  cols: ColKey[];
  setCols: (c: ColKey[]) => void;
  close: () => void;
}) {
  return (
    <div className="menubg" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <div
        className="ctx cols"
        style={{ left: Math.max(8, Math.min(pos.x, window.innerWidth - 250)), top: Math.max(8, Math.min(pos.y, window.innerHeight - 440)) }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <small>Show columns</small>
        {COLUMNS.map((c) => (
          <label key={c.key} className={c.locked ? "locked" : ""} title={c.title}>
            <input
              type="checkbox"
              checked={cols.includes(c.key)}
              disabled={c.locked}
              onChange={() => setCols(COLUMNS.map((x) => x.key).filter((k) => (k === c.key ? !cols.includes(k) : cols.includes(k))))}
            />
            {c.title}
          </label>
        ))}
        <div className="csep" />
        <button onClick={() => setCols(DEFAULT_COLS)}>Reset to default</button>
      </div>
    </div>
  );
}
