import type { ReactNode } from "react";
import { fmtBytes, fmtDate, fmtShort, fmtSpeed, hostOf, type Torrent } from "./api";
import { statusLabel } from "./filters";

export type ColKey =
  | "name"
  | "progress"
  | "status"
  | "size"
  | "down"
  | "up"
  | "eta"
  | "ratio"
  | "peers"
  | "known"
  | "category"
  | "tags"
  | "tracker"
  | "downloaded"
  | "uploaded"
  | "remaining"
  | "added"
  | "completed"
  | "path"
  | "queue";

export interface Col {
  key: ColKey;
  label: string;
  /** shown in the column picker */
  title: string;
  width: string;
  sort: (t: Torrent) => number | string;
  cell: (t: Torrent) => ReactNode;
  /** first-sort direction: 1 = ascending (text), -1 = descending (numbers) */
  firstDir: 1 | -1;
  locked?: boolean;
  align?: "right";
}

const ratio = (t: Torrent) => (t.downloadedBytes ? t.uploadedBytes / t.downloadedBytes : 0);
const dash = <span className="faint">—</span>;

export const COLUMNS: Col[] = [
  {
    key: "name",
    label: "NAME",
    title: "Name",
    width: "minmax(220px, 2.6fr)",
    sort: (t) => t.name.toLowerCase(),
    cell: (t) => t.name,
    firstDir: 1,
    locked: true,
  },
  {
    key: "progress",
    label: "PROGRESS",
    title: "Progress",
    width: "minmax(120px, 1.3fr)",
    sort: (t) => t.progress,
    cell: () => null, // rendered specially (bar)
    firstDir: -1,
  },
  {
    key: "status",
    label: "STATUS",
    title: "Status",
    width: "110px",
    sort: (t) => statusLabel(t),
    cell: (t) => statusLabel(t),
    firstDir: 1,
  },
  {
    key: "size",
    label: "SIZE",
    title: "Size",
    width: "84px",
    sort: (t) => t.totalBytes,
    cell: (t) => (t.totalBytes ? fmtBytes(t.totalBytes) : dash),
    firstDir: -1,
  },
  {
    key: "down",
    label: "↓ SPEED",
    title: "Download speed",
    width: "96px",
    sort: (t) => t.downBps,
    cell: (t) => (t.downBps ? <span className="hot">{fmtSpeed(t.downBps)}</span> : dash),
    firstDir: -1,
  },
  {
    key: "up",
    label: "↑ SPEED",
    title: "Upload speed",
    width: "96px",
    sort: (t) => t.upBps,
    cell: (t) => (t.upBps ? <span className="hot up">{fmtSpeed(t.upBps)}</span> : dash),
    firstDir: -1,
  },
  {
    key: "eta",
    label: "ETA",
    title: "Time left (ETA)",
    width: "76px",
    sort: (t) => t.etaSecs ?? Number.MAX_SAFE_INTEGER,
    cell: (t) => (t.finished ? "Done" : t.etaSecs == null ? dash : fmtShort(t.etaSecs)),
    firstDir: 1,
  },
  {
    key: "ratio",
    label: "RATIO",
    title: "Share ratio",
    width: "70px",
    sort: ratio,
    cell: (t) => ratio(t).toFixed(2),
    firstDir: -1,
  },
  {
    key: "peers",
    label: "PEERS",
    title: "Connected peers",
    width: "66px",
    sort: (t) => t.peers,
    cell: (t) => t.peers,
    firstDir: -1,
  },
  {
    key: "known",
    label: "SWARM",
    title: "Known peers (found, not necessarily connected)",
    width: "70px",
    sort: (t) => t.knownPeers,
    cell: (t) => t.knownPeers,
    firstDir: -1,
  },
  {
    key: "category",
    label: "CATEGORY",
    title: "Category",
    width: "110px",
    sort: (t) => (t.category ?? "").toLowerCase(),
    cell: (t) => t.category ?? dash,
    firstDir: 1,
  },
  {
    key: "tags",
    label: "TAGS",
    title: "Tags",
    width: "120px",
    sort: (t) => t.tags.join(",").toLowerCase(),
    cell: (t) => (t.tags.length ? t.tags.join(", ") : dash),
    firstDir: 1,
  },
  {
    key: "tracker",
    label: "TRACKER",
    title: "Tracker",
    width: "150px",
    sort: (t) => (t.trackers[0] ? hostOf(t.trackers[0]) : ""),
    cell: (t) => (t.trackers[0] ? hostOf(t.trackers[0]) + (t.trackers.length > 1 ? ` +${t.trackers.length - 1}` : "") : dash),
    firstDir: 1,
  },
  {
    key: "downloaded",
    label: "DOWNLOADED",
    title: "Downloaded",
    width: "100px",
    sort: (t) => t.downloadedBytes,
    cell: (t) => fmtBytes(t.downloadedBytes),
    firstDir: -1,
  },
  {
    key: "uploaded",
    label: "UPLOADED",
    title: "Uploaded",
    width: "90px",
    sort: (t) => t.uploadedBytes,
    cell: (t) => fmtBytes(t.uploadedBytes),
    firstDir: -1,
  },
  {
    key: "remaining",
    label: "REMAINING",
    title: "Remaining",
    width: "96px",
    sort: (t) => Math.max(0, t.totalBytes - t.downloadedBytes),
    cell: (t) => fmtBytes(Math.max(0, t.totalBytes - t.downloadedBytes)),
    firstDir: -1,
  },
  {
    key: "added",
    label: "ADDED ON",
    title: "Added on",
    width: "150px",
    sort: (t) => t.addedOn,
    cell: (t) => fmtDate(t.addedOn),
    firstDir: -1,
  },
  {
    key: "completed",
    label: "COMPLETED ON",
    title: "Completed on",
    width: "150px",
    sort: (t) => t.completedOn,
    cell: (t) => (t.completedOn ? fmtDate(t.completedOn) : dash),
    firstDir: -1,
  },
  {
    key: "path",
    label: "SAVE PATH",
    title: "Save path",
    width: "minmax(160px, 1.4fr)",
    sort: (t) => t.savePath.toLowerCase(),
    cell: (t) => t.savePath,
    firstDir: 1,
  },
];

COLUMNS.push({
  key: "queue",
  label: "QUEUE #",
  title: "Queue position",
  width: "76px",
  sort: (t) => (t.finished ? Number.MAX_SAFE_INTEGER : t.queuePos ?? Number.MAX_SAFE_INTEGER),
  cell: (t) => (t.finished || t.queuePos == null ? dash : t.queuePos + 1),
  firstDir: 1,
});

export const DEFAULT_COLS: ColKey[] = ["name", "progress", "size", "down", "up", "eta", "peers"];

export const loadCols = (raw: string | null): ColKey[] => {
  try {
    const arr = JSON.parse(raw ?? "null") as ColKey[] | null;
    if (Array.isArray(arr)) {
      const valid = COLUMNS.map((c) => c.key);
      const kept = arr.filter((k) => valid.includes(k));
      if (!kept.includes("name")) kept.unshift("name");
      return kept;
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_COLS;
};
