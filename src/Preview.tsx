import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText, fmtBytes, PRIORITIES, type Category, type Preview } from "./api";
import { KINDS } from "./filters";
import { Icon, Modal } from "./ui";

export interface PreviewSource {
  /** a magnet link or an http(s) link to a .torrent file */
  magnet?: string;
  path?: string;
  /** shown while the file list loads (search results know their name) */
  title?: string;
}

type Stage = { s: "loading" } | { s: "error"; msg: string } | { s: "ready"; p: Preview };

const label = (src: PreviewSource) =>
  src.title ??
  (src.magnet ? (/[?&]dn=([^&]+)/.exec(src.magnet)?.[1] ?? "magnet link").replace(/\+/g, " ") : src.path?.split(/[\\/]/).pop() ?? "");

export function PreviewDialog({
  source,
  categories,
  tags,
  defaultPaused,
  more,
  onClose,
  onAdded,
  onExisting,
}: {
  source: PreviewSource;
  categories: Category[];
  tags: string[];
  defaultPaused: boolean;
  /** how many more links are waiting after this one */
  more: number;
  onClose: () => void;
  onAdded: (msg: string) => void;
  onExisting: (id: number) => void;
}) {
  const [stage, setStage] = useState<Stage>({ s: "loading" });
  const [prio, setPrio] = useState<Record<number, number>>({}); // missing = normal, 0 = skip
  const [filter, setFilter] = useState("");
  const [savePath, setSavePath] = useState("");
  const [category, setCategory] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [paused, setPaused] = useState(defaultPaused);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [waited, setWaited] = useState(0);
  const cancelled = useRef(false);
  const token = useRef("");

  useEffect(() => {
    cancelled.current = false;
    api
      .preview(source)
      .then((p) => {
        if (cancelled.current) {
          if (p.token) api.dropPreview(p.token);
          return;
        }
        if (p.existingId !== null) return onExisting(p.existingId);
        token.current = p.token;
        // files start as Normal; "do not download" is explicit
        setStage({ s: "ready", p });
      })
      .catch((e) => !cancelled.current && setStage({ s: "error", msg: errText(e) }));
    const tick = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => {
      cancelled.current = true;
      clearInterval(tick);
      if (token.current) api.dropPreview(token.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = stage.s === "ready" ? stage.p : null;
  const pr = (i: number) => prio[i] ?? 1;
  const catPath = categories.find((c) => c.name === category)?.savePath;
  const files = p?.files ?? [];
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  }, [files, filter]);
  const picked = files.filter((f) => pr(f.index) > 0);
  const pickedBytes = picked.reduce((a, f) => a + f.size, 0);
  const kind = KINDS.find((k) => k.key === p?.kind);

  const set = (idx: number[], v: number) =>
    setPrio((cur) => {
      const next = { ...cur };
      for (const i of idx) {
        if (v === 1) delete next[i];
        else next[i] = v;
      }
      return next;
    });

  const submit = async () => {
    if (!p) return;
    setBusy(true);
    setErr("");
    try {
      await api.addPreviewed({
        token: p.token,
        prios: prio,
        savePath: savePath.trim() || undefined,
        category: category || null,
        tags: chosen,
        paused,
      });
      token.current = ""; // the backend consumed it
      onAdded(`Added “${p.name}”`);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  const addAnyway = async () => {
    setBusy(true);
    try {
      const r = await api.add(source.magnet ? { magnet: source.magnet, category: category || null } : { paths: [source.path!] });
      onAdded(r.unsorted ? "Added — it will sort itself out once peers answer" : "Added");
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Add torrent" onClose={onClose} wide>
      {stage.s === "loading" && (
        <div className="pv-loading" role="status">
          <div className="spinner" />
          <b>Reading the torrent…</b>
          <small>{label(source)}</small>
          <small className="faint">
            {source.magnet
              ? waited < 8
                ? "Asking peers for the file list."
                : `Still looking for peers (${waited}s). Magnet links can take a minute.`
              : "Opening file."}
          </small>
          <div className="mbtns">
            <span />
            <button onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}

      {stage.s === "error" && (
        <div>
          <div className="err">{stage.msg}</div>
          {err && <div className="err">{err}</div>}
          <p className="note">
            {source.magnet
              ? "You can still add it now. It will start once peers are found and go to the main download folder."
              : "That file couldn’t be read."}
          </p>
          <div className="mbtns">
            <span />
            <button onClick={onClose}>Cancel</button>
            {source.magnet && (
              <button className="primary" disabled={busy} onClick={addAnyway}>
                Add without choosing files
              </button>
            )}
          </div>
        </div>
      )}

      {p && (
        <>
          <div className="pv-head">
            <div className="pv-title" title={p.name}>
              {p.name || "Unnamed torrent"}
            </div>
            <div className="pv-sub">
              {kind && (
                <span className="pv-kind">
                  <Icon d={kind.icon} size={13} /> {kind.label}
                </span>
              )}
              <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
              <span>{fmtBytes(p.totalBytes)}</span>
              {more > 0 && <span className="faint">+{more} more waiting</span>}
            </div>
          </div>

          <div className="pv-tools">
            <input
              className="pv-filter"
              placeholder="Filter files…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter files"
            />
            <button className="lnk" onClick={() => set(files.map((f) => f.index), 1)}>
              Select all
            </button>
            <button
              className="lnk"
              onClick={() => {
                // keep the first file so there's always something to download
                const [first, ...rest] = files;
                set(rest.map((f) => f.index), 0);
                if (first) set([first.index], 1);
              }}
            >
              Select none
            </button>
            <label className="prio-all">
              Priority of shown:
              <select
                value=""
                onChange={(e) => e.target.value !== "" && set(shown.map((f) => f.index), Number(e.target.value))}
                aria-label="Set priority for shown files"
              >
                <option value="">Set…</option>
                {PRIORITIES.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="pv-files">
            <table className="grid-table ftable">
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th>Name</th>
                  <th style={{ width: 90 }}>Size</th>
                  <th style={{ width: 150 }}>Priority</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => (
                  <tr key={f.index} className={pr(f.index) === 0 ? "skipped" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={pr(f.index) > 0}
                        onChange={() => set([f.index], pr(f.index) > 0 ? 0 : 1)}
                        aria-label={`Download ${f.path}`}
                      />
                    </td>
                    <td className="sel" title={f.path}>
                      {f.path}
                    </td>
                    <td>{fmtBytes(f.size)}</td>
                    <td>
                      <select
                        className={`prio p${pr(f.index)}`}
                        value={pr(f.index)}
                        onChange={(e) => set([f.index], Number(e.target.value))}
                        aria-label={`Priority for ${f.path}`}
                      >
                        {PRIORITIES.map((x) => (
                          <option key={x.value} value={x.value}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      No files match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pv-sum">
            Downloading {picked.length} of {files.length} files · {fmtBytes(pickedBytes)}
            <span className="faint"> — Maximum first, then High, then Normal.</span>
          </div>

          <div className="two">
            <label className="fld">
              <span>Save to</span>
              <div className="inrow">
                <input
                  value={savePath}
                  onChange={(e) => setSavePath(e.target.value)}
                  placeholder={catPath || p.suggestedPath || "Default download folder"}
                />
                <button
                  className="ghost"
                  onClick={async () => {
                    const r = await open({ directory: true });
                    if (typeof r === "string") setSavePath(r);
                  }}
                >
                  Browse…
                </button>
              </div>
            </label>
            <label className="fld">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {tags.length > 0 && (
            <div className="chips pv-tags">
              {tags.map((t) => (
                <button
                  key={t}
                  className={`chip ${chosen.includes(t) ? "on" : ""}`}
                  onClick={() => setChosen(chosen.includes(t) ? chosen.filter((x) => x !== t) : [...chosen, t])}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
            Don’t start automatically
          </label>
          {err && <div className="err">{err}</div>}
          <div className="mbtns">
            <span />
            <button onClick={onClose}>{more > 0 ? "Skip" : "Cancel"}</button>
            <button className="primary" disabled={busy || picked.length === 0} onClick={submit}>
              {busy ? "Adding…" : "Download"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

