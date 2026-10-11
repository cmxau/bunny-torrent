import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  errText,
  fmtBytes,
  fmtDate,
  fmtDuration,
  fmtSpeed,
  fmtTime,
  hostOf,
  PRIORITIES,
  type Details as D,
  type FileOut,
  type Snapshot,
  type Torrent,
} from "./api";
import { statusLabel } from "./filters";
import { Chart, Icon, P } from "./ui";

type Tab = "general" | "trackers" | "peers" | "content" | "speed";
const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "trackers", label: "Trackers" },
  { key: "peers", label: "Peers" },
  { key: "content", label: "Content" },
  { key: "speed", label: "Speed" },
];

export interface SessionBase {
  down: number;
  up: number;
  t0: number;
}

const NA = "Not reported by the transfer engine";

export function DetailsPanel({
  t,
  snap,
  hist,
  session,
  onClose,
  refresh,
  flash,
  onAddTrackers,
}: {
  t: Torrent;
  snap: Snapshot;
  hist: { d: number[]; u: number[] } | undefined;
  session: SessionBase | undefined;
  onClose: () => void;
  refresh: () => void;
  flash: (m: string) => void;
  onAddTrackers: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [d, setD] = useState<D | null>(null);

  useEffect(() => {
    setD(null);
  }, [t.id]);
  useEffect(() => {
    if (tab === "trackers" || tab === "speed") return;
    let live = true;
    const load = () =>
      api
        .details(t.id)
        .then((x) => live && setD(x))
        .catch(() => {});
    load();
    const i = setInterval(load, tab === "peers" || tab === "content" ? 1500 : 4000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, [t.id, tab]);

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      flash(errText(e));
    }
    refresh();
  };

  return (
    <section className="details">
      <div className="dtabs" role="tablist">
        <div className="dname" title={t.name}>
          {t.name}
        </div>
        {TABS.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? "on" : ""} onClick={() => setTab(x.key)}>
            {x.label}
            {x.key === "peers" && <em>{t.peers}</em>}
            {x.key === "trackers" && <em>{t.trackers.length}</em>}
            {x.key === "content" && d && <em>{d.files.length}</em>}
          </button>
        ))}
        <span className="grow" />
        <button className="x" onClick={onClose} title="Close details (Esc)" aria-label="Close details">
          <Icon d={P.close} size={16} />
        </button>
      </div>

      <div className="dbody">
        {tab === "general" && <General t={t} snap={snap} d={d} session={session} run={run} flash={flash} />}

        {tab === "trackers" && (
          <div>
            <div className="toolbar">
              <span className="faint">
                {t.trackers.length
                  ? "Trackers announcing this torrent."
                  : "This torrent has no trackers — it relies on DHT and peer exchange."}
              </span>
              <button className="ghost" onClick={onAddTrackers}>
                <Icon d={P.plus} size={13} /> Add to tracker list
              </button>
            </div>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Host</th>
                  <th>Protocol</th>
                </tr>
              </thead>
              <tbody>
                {t.trackers.map((u) => (
                  <tr key={u}>
                    <td className="sel">{u}</td>
                    <td>{hostOf(u)}</td>
                    <td>{u.split(":")[0].toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "peers" && (
          <table className="grid-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Client</th>
                <th>Type</th>
                <th>Downloaded from</th>
                <th>Uploaded to</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {(d?.peers ?? []).map((p) => (
                <tr key={p.addr}>
                  <td className="sel">{p.addr}</td>
                  <td>{p.client ?? "—"}</td>
                  <td>{p.kind ?? "—"}</td>
                  <td>{fmtBytes(p.downloaded)}</td>
                  <td>{fmtBytes(p.uploaded)}</td>
                  <td>{p.errors}</td>
                </tr>
              ))}
              {d && d.peers.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No connected peers right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === "content" && (
          <ContentTab
            t={t}
            d={d}
            setPriority={(files, p) => run(() => api.setFilePriority(t.id, files, p))}
          />
        )}

        {tab === "speed" && (
          <div className="speedtab">
            <div className="spchart">
              <Chart d={hist?.d ?? null} u={hist?.u ?? null} />
            </div>
            <div className="general tight">
              <Field l="Download speed" v={fmtSpeed(t.downBps)} />
              <Field l="Upload speed" v={fmtSpeed(t.upBps)} />
              <Field l="Average (last 2 min)" v={fmtSpeed(avg(hist?.d))} />
              <Field l="Peak (last 2 min)" v={fmtSpeed(Math.max(0, ...(hist?.d ?? [])))} />
              <Field l="Download limit" v={snap.settings.dlLimitKib ? fmtSpeed(snap.settings.dlLimitKib * 1024) : "Unlimited"} />
              <Field l="Upload limit" v={snap.settings.ulLimitKib ? fmtSpeed(snap.settings.ulLimitKib * 1024) : "Unlimited"} />
            </div>
            <p className="note">Limits apply to the whole app and can be changed in Settings → Speed.</p>
          </div>
        )}
      </div>
    </section>
  );
}

const avg = (a?: number[]) => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function Field({ l, v }: { l: string; v: string }) {
  return (
    <div className="field">
      <small>{l}</small>
      <b>{v}</b>
    </div>
  );
}

/** A label/value pair laid out like qBittorrent's General tab. */
function KV({ l, children, na }: { l: string; children?: ReactNode; na?: boolean }) {
  return (
    <div className="kv" title={na ? NA : undefined}>
      <span className="k">{l}:</span>
      <span className={`v ${na ? "faint" : ""}`}>{na ? "—" : children}</span>
    </div>
  );
}

function General({
  t,
  snap,
  d,
  session,
  run,
  flash,
}: {
  t: Torrent;
  snap: Snapshot;
  d: D | null;
  session: SessionBase | undefined;
  run: (f: () => Promise<unknown>) => void;
  flash: (m: string) => void;
}) {
  const sDown = session ? Math.max(0, t.downloadedBytes - session.down) : 0;
  const sUp = session ? Math.max(0, t.uploadedBytes - session.up) : 0;
  const secs = session ? Math.max(1, (Date.now() - session.t0) / 1000) : 1;
  const ratio = t.downloadedBytes ? t.uploadedBytes / t.downloadedBytes : 0;
  const lim = (k: number) => (k ? fmtSpeed(k * 1024) : "∞");
  const have = d && d.pieceLen ? Math.min(d.pieces, Math.floor(t.downloadedBytes / d.pieceLen)) : 0;

  return (
    <div className="gen">
      <div className="genprog">
        <span>Progress:</span>
        <span className="prog">
          <b className={t.finished ? "ok" : ""} style={{ width: `${Math.max(0.5, t.progress * 100)}%` }} />
        </span>
        <span>{(t.progress * 100).toFixed(1)}%</span>
      </div>

      <h4>Transfer</h4>
      <div className="kvgrid">
        <KV l="Time Active">{fmtDuration(t.activeSecs)}</KV>
        <KV l="ETA">{t.finished ? "Done" : t.etaSecs == null ? "∞" : fmtTime(t.etaSecs)}</KV>
        <KV l="Connections">
          {t.peers} ({snap.settings.peerLimit || "default"} max)
        </KV>

        <KV l="Downloaded">
          {fmtBytes(t.downloadedBytes)} ({fmtBytes(sDown)} this session)
        </KV>
        <KV l="Uploaded">
          {fmtBytes(t.uploadedBytes)} ({fmtBytes(sUp)} this session)
        </KV>

        <KV l="Download Speed">
          {fmtSpeed(t.downBps)} ({fmtSpeed(sDown / secs)} avg.)
        </KV>
        <KV l="Upload Speed">
          {fmtSpeed(t.upBps)} ({fmtSpeed(sUp / secs)} avg.)
        </KV>
        <KV l="Peers">
          {t.peers} ({t.knownPeers} total)
        </KV>

        <KV l="Download Limit">{lim(snap.settings.dlLimitKib)}</KV>
        <KV l="Upload Limit">{lim(snap.settings.ulLimitKib)}</KV>

        <KV l="Share Ratio">{ratio.toFixed(2)}</KV>
      </div>

      <h4>Information</h4>
      <div className="kvgrid">
        <KV l="Total Size">{fmtBytes(t.totalBytes)}</KV>
        <KV l="Pieces">
          {d && d.pieces ? `${d.pieces.toLocaleString()} x ${fmtBytes(d.pieceLen)} (have ${have.toLocaleString()})` : "—"}
        </KV>
        <KV l="Created By" na={!d?.createdBy}>
          {d?.createdBy}
        </KV>

        <KV l="Added On">{fmtDate(t.addedOn)}</KV>
        <KV l="Completed On" na={!t.completedOn}>
          {fmtDate(t.completedOn)}
        </KV>
        <KV l="Created On" na={!d?.createdOn}>
          {d?.createdOn ? fmtDate(d.createdOn) : ""}
        </KV>

        <KV l="Private">{d ? (d.private ? "Yes" : "No") : "—"}</KV>
      </div>
      <div className="kvwide">
        <div className="kv">
          <span className="k">Info Hash v1:</span>
          <span className="v mono sel">
            {t.hash}{" "}
            <button className="lnk" onClick={() => navigator.clipboard.writeText(t.hash).then(() => flash("Hash copied"))}>
              Copy
            </button>
          </span>
        </div>
        <div className="kv">
          <span className="k">Info Hash v2:</span>
          <span className="v faint">N/A</span>
        </div>
        <div className="kv">
          <span className="k">Save Path:</span>
          <span className="v sel">
            {t.savePath}{" "}
            <button className="lnk" onClick={() => api.openFolder(t.savePath)}>
              Open
            </button>
          </span>
        </div>
        <div className="kv">
          <span className="k">Comment:</span>
          <span className="v sel">{d?.comment ?? <span className="faint">—</span>}</span>
        </div>
      </div>

      <h4>Organise</h4>
      <div className="kvwide">
        <div className="kv">
          <span className="k">Category:</span>
          <select
            className="inl"
            value={t.category ?? ""}
            onChange={(e) => run(() => api.setCategory([t.id], e.target.value || null))}
          >
            <option value="">Uncategorised</option>
            {snap.categories.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="kv">
          <span className="k">Tags:</span>
          <span className="chips">
            {snap.tags.length === 0 && <em className="faint">Create tags from the sidebar “+” button.</em>}
            {snap.tags.map((g) => (
              <button
                key={g}
                className={`chip ${t.tags.includes(g) ? "on" : ""}`}
                onClick={() =>
                  run(() => api.setTags([t.id], t.tags.includes(g) ? t.tags.filter((x) => x !== g) : [...t.tags, g]))
                }
              >
                {g}
              </button>
            ))}
          </span>
        </div>
      </div>
      {t.error && <div className="err">{t.error}</div>}
      <span className="faint tiny">Status: {statusLabel(t)}</span>
    </div>
  );
}

function ContentTab({
  t,
  d,
  setPriority,
}: {
  t: Torrent;
  d: D | null;
  setPriority: (files: number[], priority: number) => void;
}) {
  if (!d) return <div className="emptystate">Loading files…</div>;
  if (d.files.length === 0)
    return (
      <div className="emptystate">
        <b>No file list yet</b>
        <p>{t.name === "Fetching metadata..." ? "Waiting for metadata from peers…" : "Nothing to show."}</p>
      </div>
    );
  const allOn = d.files.every((f) => f.included);
  const someOn = d.files.some((f) => f.included);
  const all = d.files.map((f) => f.index);
  const mixed = new Set(d.files.map((f) => f.priority)).size > 1;

  return (
    <div>
      <div className="toolbar">
        <span className="faint">
          Maximum files download first, then High, then Normal. Unticked files are skipped.
        </span>
        <label className="prio-all">
          All files:
          <select
            value={mixed ? "" : String(d.files[0].priority)}
            onChange={(e) => e.target.value !== "" && setPriority(all, Number(e.target.value))}
            aria-label="Set priority for all files"
          >
            {mixed && <option value="">Mixed</option>}
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <table className="grid-table ftable">
        <thead>
          <tr>
            <th style={{ width: 34 }}>
              <input
                type="checkbox"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = someOn && !allOn;
                }}
                onChange={() => setPriority(all, allOn ? 0 : 1)}
                aria-label="Download all files"
              />
            </th>
            <th>Name</th>
            <th style={{ width: 96 }}>Total Size</th>
            <th style={{ width: 170 }}>Progress</th>
            <th style={{ width: 150 }}>Download Priority</th>
            <th style={{ width: 96 }}>Remaining</th>
          </tr>
        </thead>
        <tbody>
          {d.files.map((f) => (
            <FileRow key={f.index} f={f} setPriority={setPriority} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileRow({ f, setPriority }: { f: FileOut; setPriority: (files: number[], priority: number) => void }) {
  const p = f.size ? Math.min(1, f.done / f.size) : 1;
  const remaining = Math.max(0, f.size - f.done);
  return (
    <tr className={f.included ? "" : "skipped"}>
      <td>
        <input
          type="checkbox"
          checked={f.included}
          onChange={() => setPriority([f.index], f.included ? 0 : 1)}
          aria-label={`Download ${f.path}`}
        />
      </td>
      <td className="sel" title={f.path}>
        {f.path}
      </td>
      <td>{fmtBytes(f.size)}</td>
      <td>
        <div className="mini">
          <span className="prog">
            <b className={p >= 1 ? "ok" : ""} style={{ width: `${Math.max(1, p * 100)}%` }} />
          </span>
          <small>{Math.floor(p * 100)}%</small>
        </div>
      </td>
      <td>
        <select
          className={`prio p${f.priority}`}
          value={f.priority}
          onChange={(e) => setPriority([f.index], Number(e.target.value))}
          aria-label={`Priority for ${f.path}`}
        >
          {PRIORITIES.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
      </td>
      <td>{f.included ? fmtBytes(remaining) : "—"}</td>
    </tr>
  );
}
