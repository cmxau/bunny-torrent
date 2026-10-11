import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText, type AddReq, type Category } from "./api";
import { Icon, Modal, P } from "./ui";

export interface AddInitial {
  magnet?: string;
  paths?: string[];
  category?: string | null;
  tags?: string[];
}

export function AddDialog({
  initial,
  categories,
  tags,
  defaultPaused,
  onClose,
  onDone,
  onPreview,
}: {
  initial: AddInitial;
  categories: Category[];
  tags: string[];
  defaultPaused: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
  onPreview: (src: { magnet?: string; path?: string }) => void;
}) {
  const [magnet, setMagnet] = useState(initial.magnet ?? "");
  const [paths, setPaths] = useState<string[]>(initial.paths ?? []);
  const [savePath, setSavePath] = useState("");
  const [category, setCategory] = useState<string>(initial.category ?? "");
  const [chosen, setChosen] = useState<string[]>(initial.tags ?? []);
  const [paused, setPaused] = useState(defaultPaused);
  const [trackers, setTrackers] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const catPath = categories.find((c) => c.name === category)?.savePath;
  const ok = magnet.trim() !== "" || paths.length > 0;

  const browseFiles = async () => {
    const r = await open({ multiple: true, filters: [{ name: "Torrent", extensions: ["torrent"] }] });
    if (r) setPaths((p) => [...new Set([...p, ...(Array.isArray(r) ? r : [r])])]);
  };
  const browseDir = async () => {
    const r = await open({ directory: true });
    if (typeof r === "string") setSavePath(r);
  };
  const submit = async () => {
    setBusy(true);
    setErr("");
    const req: AddReq = {
      magnet: magnet.trim() || undefined,
      paths,
      savePath: savePath.trim() || undefined,
      category: category || null,
      tags: chosen,
      paused,
      trackers: trackers.split(/\s+/).filter(Boolean),
    };
    try {
      const r = await api.add(req);
      const parts = [];
      if (r.added) parts.push(`Added ${r.added} torrent${r.added > 1 ? "s" : ""}`);
      if (r.duplicates) parts.push(`${r.duplicates} already in your list`);
      if (r.unsorted) parts.push(`${r.unsorted} added to the main folder (contents not readable yet)`);
      onDone(parts.join(" · ") || "Nothing added");
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Add torrent" onClose={onClose} wide>
      <label className="fld">
        <span>Magnet links or torrent URLs (one per line)</span>
        <textarea
          autoFocus
          rows={3}
          placeholder="magnet:?xt=urn:btih:…"
          value={magnet}
          onChange={(e) => setMagnet(e.target.value)}
        />
      </label>
      <div className="fld">
        <span>Torrent files</span>
        <div className="filebox">
          {paths.length === 0 && <em>No files selected. You can also drop them anywhere on the window.</em>}
          {paths.map((p) => (
            <div key={p} className="chip-file">
              <span>{p.split(/[\\/]/).pop()}</span>
              <button onClick={() => setPaths(paths.filter((x) => x !== p))} aria-label="Remove file">
                <Icon d={P.close} size={12} />
              </button>
            </div>
          ))}
          <button className="ghost" onClick={browseFiles}>
            Browse…
          </button>
        </div>
      </div>
      <div className="two">
        <label className="fld">
          <span>Save to</span>
          <div className="inrow">
            <input
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              placeholder={catPath || "Default download folder"}
            />
            <button className="ghost" onClick={browseDir}>
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
        <div className="fld">
          <span>Tags</span>
          <div className="chips">
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
        </div>
      )}
      <label className="fld">
        <span>Extra trackers (optional, one per line)</span>
        <textarea
          rows={2}
          placeholder="udp://tracker.example.org:1337/announce"
          value={trackers}
          onChange={(e) => setTrackers(e.target.value)}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
        Don’t start automatically
      </label>
      {err && <div className="err">{err}</div>}
      <div className="mbtns">
        {(() => {
          const lines = magnet.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          const one =
            lines.length === 1 && paths.length === 0
              ? { magnet: lines[0] }
              : lines.length === 0 && paths.length === 1
                ? { path: paths[0] }
                : null;
          return one ? (
            <button className="ghost" onClick={() => onPreview(one)} title="See what is inside and pick files and priorities">
              Choose files first…
            </button>
          ) : (
            <span />
          );
        })()}
        <span />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!ok || busy} onClick={submit}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </Modal>
  );
}

export function TrackerDialog({
  current,
  onClose,
  onDone,
}: {
  current: string[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const submit = async () => {
    try {
      const n = await api.addTrackerList(text.split(/\s+/).filter(Boolean));
      onDone(n ? `Added ${n} tracker${n > 1 ? "s" : ""} to your list` : "Those trackers are already in your list");
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal title="Add trackers to list" onClose={onClose}>
      <p className="note">
        Trackers in this list are attached to every torrent you add from now on (turn this off in Settings → Trackers).
        {current.length > 0 && ` You have ${current.length} saved.`}
      </p>
      <label className="fld">
        <span>One URL per line (http://, https:// or udp://)</span>
        <textarea
          autoFocus
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"udp://tracker.opentrackr.org:1337/announce\nhttps://tracker.example.org/announce"}
        />
      </label>
      {err && <div className="err">{err}</div>}
      <div className="mbtns">
        <span />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!text.trim()} onClick={submit}>
          Add to list
        </button>
      </div>
    </Modal>
  );
}

export function NameDialog({
  title,
  label,
  withPath,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  withPath?: boolean;
  onClose: () => void;
  onSubmit: (name: string, path?: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [err, setErr] = useState("");
  const go = async () => {
    try {
      await onSubmit(name.trim(), path.trim() || undefined);
      onClose();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <label className="fld">
        <span>{label}</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && go()}
        />
      </label>
      {withPath && (
        <div className="fld">
          <span>Save path (optional — torrents in this category download here)</span>
          <div className="inrow">
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="Default download folder" />
            <button
              className="ghost"
              onClick={async () => {
                const r = await open({ directory: true });
                if (typeof r === "string") setPath(r);
              }}
            >
              Browse…
            </button>
          </div>
        </div>
      )}
      {err && <div className="err">{err}</div>}
      <div className="mbtns">
        <span />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={go}>
          Create
        </button>
      </div>
    </Modal>
  );
}

export interface Confirm {
  title: string;
  body: string;
  action: string;
  run: () => Promise<void>;
}

export function ConfirmDialog({ confirm, onClose, run }: { confirm: Confirm; onClose: () => void; run: (f: () => Promise<void>) => Promise<void> }) {
  return (
    <Modal title={confirm.title} onClose={onClose}>
      <p className="note">{confirm.body}</p>
      <div className="mbtns">
        <span />
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary danger"
          autoFocus
          onClick={async () => {
            onClose();
            await run(confirm.run);
          }}
        >
          {confirm.action}
        </button>
      </div>
    </Modal>
  );
}

/** The "new category" / "new tag" / "tracker list" dialogs opened from the sidebar and Settings. */
export function ListDialogs({
  dialog,
  trackerList,
  onClose,
  flash,
  poll,
}: {
  dialog: null | "category" | "tag" | "trackers";
  trackerList: string[];
  onClose: () => void;
  flash: (m: string) => void;
  poll: () => void;
}) {
  if (dialog === "category")
    return (
      <NameDialog
        title="New category"
        label="Category name"
        withPath
        onClose={onClose}
        onSubmit={async (n, p) => {
          await api.createCategory(n, p);
          poll();
        }}
      />
    );
  if (dialog === "tag")
    return (
      <NameDialog
        title="New tag"
        label="Tag name"
        onClose={onClose}
        onSubmit={async (n) => {
          await api.createTag(n);
          poll();
        }}
      />
    );
  if (dialog === "trackers")
    return (
      <TrackerDialog
        current={trackerList}
        onClose={onClose}
        onDone={(m) => {
          onClose();
          flash(m);
          poll();
        }}
      />
    );
  return null;
}
