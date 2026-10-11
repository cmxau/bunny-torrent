import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, errText, fmtBytes, type Category, type CreateResult } from "./api";
import { Modal } from "./ui";

const PIECES = [
  { kib: 0, label: "Automatic" },
  { kib: 256, label: "256 KiB" },
  { kib: 512, label: "512 KiB" },
  { kib: 1024, label: "1 MiB" },
  { kib: 2048, label: "2 MiB" },
  { kib: 4096, label: "4 MiB" },
  { kib: 8192, label: "8 MiB" },
  { kib: 16384, label: "16 MiB" },
];

export function CreateDialog({
  categories,
  trackerList,
  onClose,
  onCreated,
  flash,
}: {
  categories: Category[];
  trackerList: string[];
  onClose: () => void;
  onCreated: () => void;
  flash: (m: string) => void;
}) {
  const [source, setSource] = useState("");
  const [savePath, setSavePath] = useState("");
  const [trackers, setTrackers] = useState(trackerList.join("\n"));
  const [comment, setComment] = useState("");
  const [piece, setPiece] = useState(0);
  const [seed, setSeed] = useState(true);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);

  const pickFile = async () => {
    const r = await open({ multiple: false, directory: false });
    if (typeof r === "string") setSource(r);
  };
  const pickDir = async () => {
    const r = await open({ directory: true });
    if (typeof r === "string") setSource(r);
  };
  const pickSave = async () => {
    const r = await save({ filters: [{ name: "Torrent", extensions: ["torrent"] }] });
    if (r) setSavePath(r);
  };
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => flash(`${what} copied`),
      () => flash("Couldn’t copy to the clipboard"),
    );

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api.createTorrent({
        source,
        savePath: savePath.trim() || undefined,
        trackers: trackers.split(/\s+/).filter(Boolean),
        comment: comment.trim() || undefined,
        pieceLengthKib: piece || undefined,
        startSeeding: seed,
        category: category || null,
      });
      setResult(r);
      onCreated();
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  };

  if (result) {
    const folder = result.torrentPath.replace(/[\\/][^\\/]*$/, "");
    return (
      <Modal title="Torrent created" onClose={onClose} wide>
        <div className="fld">
          <span>Name</span>
          <b>{result.name}</b>
        </div>
        <div className="fld">
          <span>Size</span>
          <div>{fmtBytes(result.totalBytes)}</div>
        </div>
        <div className="fld">
          <span>Info hash</span>
          <div className="inrow">
            <input readOnly value={result.infoHash} />
            <button className="ghost" onClick={() => copy(result.infoHash, "Info hash")}>
              Copy
            </button>
          </div>
        </div>
        <div className="fld">
          <span>Magnet link</span>
          <div className="inrow">
            <input readOnly value={result.magnet} />
            <button className="ghost" onClick={() => copy(result.magnet, "Magnet link")}>
              Copy
            </button>
          </div>
        </div>
        <div className="fld">
          <span>Saved as</span>
          <div className="inrow">
            <input readOnly value={result.torrentPath} />
            <button className="ghost" onClick={() => api.openFolder(folder).catch((e) => flash(errText(e)))}>
              Show in folder
            </button>
          </div>
        </div>
        <div className="mbtns">
          <span />
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Create torrent" onClose={busy ? () => {} : onClose} wide>
      <div className="fld">
        <span>Source (a file or a folder to share)</span>
        <div className="inrow">
          <input readOnly value={source} placeholder="Nothing chosen yet" />
          <button className="ghost" onClick={pickFile} disabled={busy}>
            Choose file…
          </button>
          <button className="ghost" onClick={pickDir} disabled={busy}>
            Choose folder…
          </button>
        </div>
      </div>
      <label className="fld">
        <span>Save the .torrent as (optional)</span>
        <div className="inrow">
          <input
            value={savePath}
            onChange={(e) => setSavePath(e.target.value)}
            placeholder="Next to the source, named after it"
          />
          <button className="ghost" onClick={pickSave} disabled={busy}>
            Browse…
          </button>
        </div>
      </label>
      <label className="fld">
        <span>Trackers (one per line)</span>
        <textarea rows={3} value={trackers} onChange={(e) => setTrackers(e.target.value)} placeholder="udp://tracker.example.org:1337/announce" />
      </label>
      <label className="fld">
        <span>Comment (optional)</span>
        <input value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      <div className="two">
        <label className="fld">
          <span>Piece size</span>
          <select value={piece} onChange={(e) => setPiece(Number(e.target.value))}>
            {PIECES.map((p) => (
              <option key={p.kib} value={p.kib}>
                {p.label}
              </option>
            ))}
          </select>
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
      <label className="check">
        <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
        Start seeding it right away
      </label>
      {err && <div className="err">{err}</div>}
      <div className="mbtns">
        <span />
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="primary" disabled={!source || busy} onClick={submit}>
          {busy ? "Creating… large folders take a while" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
