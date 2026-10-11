import { useMemo, useState } from "react";
import { fmtBytes, fmtShort, fmtSpeed, type SearchResult, type Snapshot, type Torrent } from "./api";
import { statusLabel } from "./filters";
import { OnlineSearch } from "./OnlineSearch";
import { Icon, P, Ring } from "./ui";

const KIND_TILE: Record<string, string> = {
  videos: "VID",
  music: "AUD",
  documents: "DOC",
  images: "IMG",
  archives: "ZIP",
  apps: "APP",
  other: "···",
};

const tileText = (t: Torrent) => {
  const ext = t.name.includes(".") ? t.name.split(".").pop()! : "";
  return ext && ext.length <= 4 ? ext.toUpperCase() : KIND_TILE[t.kind] ?? "···";
};

export function Overview({
  snap,
  showRecent,
  setShowRecent,
  onBrowse,
  onSeeAll,
  onCreate,
  onInfo,
  onToggle,
  onAddResult,
  refresh,
  flash,
}: {
  snap: Snapshot;
  showRecent: boolean;
  setShowRecent: (v: boolean) => void;
  onBrowse: () => void;
  onSeeAll: () => void;
  onCreate: () => void;
  onInfo: (id: number) => void;
  onToggle: (t: Torrent) => void;
  onAddResult: (r: SearchResult) => void;
  refresh: () => void;
  flash: (m: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const torrents = snap.torrents;
  const up = torrents.reduce((a, t) => a + t.uploadedBytes, 0);
  const down = torrents.reduce((a, t) => a + t.downloadedBytes, 0);
  const used = Math.max(0, snap.diskTotal - snap.diskFree);
  const pct = snap.diskTotal ? used / snap.diskTotal : 0;
  // a new array every second would defeat memoisation below; only change when the contents change
  const historyKey = snap.searchHistory.join("\u0001");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => snap.searchHistory, [historyKey]);
  const recent = [...torrents].sort((a, b) => b.addedOn - a.addedOn || b.id - a.id).slice(0, 5);

  return (
    <div className="overview">
      <section className="cards4" aria-label="Totals">
        <div className="card c-up">
          <div className="ico">
            <Icon d={P.up} size={20} />
          </div>
          <div className="big">{fmtBytes(up)}</div>
          <div className="lbl">Uploaded</div>
        </div>
        <div className="card c-down">
          <div className="ico">
            <Icon d={P.down} size={20} />
          </div>
          <div className="big">{fmtBytes(down)}</div>
          <div className="lbl">Downloaded</div>
        </div>
        <div className="card c-disk">
          <div className="ico">
            <Icon d={P.folder} size={20} />
          </div>
          <div className="big">{snap.diskTotal ? fmtBytes(used) : "—"}</div>
          <div className="lbl">Used of {snap.diskTotal ? fmtBytes(snap.diskTotal) : "—"}</div>
          <Ring pct={pct} />
        </div>
        <button className="card c-drop" onClick={onBrowse} title="Drop .torrent files anywhere on the window, or click to browse">
          <div className="ico">
            <Icon d={P.upload} size={20} />
          </div>
          <div className="big sm">Drag &amp; drop torrent files</div>
          <div className="lbl">or click to browse</div>
        </button>
      </section>

      {/* room under the bar for the history list, so it never covers the recent torrents below */}
      <div className="searchzone" style={searching ? undefined : { minHeight: history.length ? 60 + Math.min(history.length, 6) * 42 + 52 : 52 }}>
        <OnlineSearch history={history} onAdd={onAddResult} refresh={refresh} flash={flash} onResultsChange={setSearching} />
      </div>

      {!searching && (
        <section className="recent" aria-label="Recent torrents">
          <div className="rhdr">
            <h2>Recent torrents</h2>
            <span className="grow" />
            <button className="lnk" onClick={onCreate} title="Make a .torrent from a file or folder on your computer">
              Create a torrent from your own files
            </button>
            {showRecent && (
              <>
                <button className="lnk upper" onClick={onSeeAll}>
                  See all torrents
                </button>
                <button className="lnk" onClick={() => setShowRecent(false)} title="Hide this list for a cleaner look">
                  Hide
                </button>
              </>
            )}
          </div>

          {!showRecent && (
            <button className="lnk" onClick={() => setShowRecent(true)}>
              Show recent torrents
            </button>
          )}

          {showRecent && recent.length === 0 && (
            <div className="empty">
              <p>Nothing here yet</p>
              <small>Search above, drop a .torrent file anywhere, or paste a magnet link.</small>
            </div>
          )}

          {showRecent &&
            recent.map((t) => {
              const stopped = t.state === "stopped";
              const queued = t.state === "queued";
              const resumable = stopped || queued;
              const done = t.finished || t.progress >= 1;
              return (
                <div className={`rec ${(stopped || queued) && !done ? "paused" : ""}`} key={t.id}>
                  <div className={`ftile k-${t.kind}`}>{tileText(t)}{queued && <i className="qbadge" title="Queued">⧖</i>}</div>
                  <div className="rmain">
                    <div className="rtitle" title={t.name}>
                      {t.name}
                    </div>
                    <div className="rmeta">
                      {done ? (
                        <span className={`pill ${t.state === "seeding" ? "seed" : ""}`}>{statusLabel(t)}</span>
                      ) : (
                        <>
                          <span className={t.upBps ? "hot up" : ""}>↑ {fmtSpeed(t.upBps)}</span>
                          <span className={t.downBps ? "hot" : ""}>↓ {fmtSpeed(t.downBps)}</span>
                          <span>{stopped ? "Stopped" : queued ? "Queued" : t.etaSecs == null ? statusLabel(t) : `${fmtShort(t.etaSecs)} left`}</span>
                        </>
                      )}
                      <span>{t.totalBytes ? fmtBytes(t.totalBytes) : ""}</span>
                    </div>
                    <span className="prog">
                      <b className={done ? "ok" : stopped ? "dim" : ""} style={{ width: `${Math.max(1, t.progress * 100)}%` }} />
                    </span>
                  </div>
                  <div className="rpct">{Math.floor(t.progress * 100)}%</div>
                  <button className="rbtn" onClick={() => onInfo(t.id)} title="Open details">
                    <Icon d="M12 8v.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" size={16} />
                    <span>Info</span>
                  </button>
                  <button className="rbtn" onClick={() => onToggle(t)} title={resumable ? "Resume" : "Pause"}>
                    <Icon d={resumable ? P.play : P.pause} size={16} />
                    <span>{resumable ? "Resume" : "Pause"}</span>
                  </button>
                </div>
              );
            })}
        </section>
      )}
    </div>
  );
}
