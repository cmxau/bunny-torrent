import { hostOf, type Torrent } from "./api";

export type StatusKey =
  | "all"
  | "downloading"
  | "seeding"
  | "completed"
  | "running"
  | "stopped"
  | "active"
  | "inactive"
  | "stalled"
  | "stalled_uploading"
  | "stalled_downloading"
  | "checking"
  | "queued"
  | "errored";

export const STATUSES: { key: StatusKey; label: string; hint: string }[] = [
  { key: "all", label: "All", hint: "Every torrent" },
  { key: "downloading", label: "Downloading", hint: "Still downloading, including stalled ones" },
  { key: "seeding", label: "Seeding", hint: "Finished and sharing" },
  { key: "completed", label: "Completed", hint: "100% downloaded" },
  { key: "running", label: "Running", hint: "Not stopped" },
  { key: "stopped", label: "Stopped", hint: "Paused by you" },
  { key: "active", label: "Active", hint: "Transferring data right now" },
  { key: "inactive", label: "Inactive", hint: "Running but not transferring" },
  { key: "stalled", label: "Stalled", hint: "Running, but no data moving" },
  { key: "stalled_uploading", label: "Stalled uploading", hint: "Seeding with nobody downloading" },
  { key: "stalled_downloading", label: "Stalled downloading", hint: "Downloading but no data arriving" },
  { key: "checking", label: "Checking", hint: "Verifying existing data" },
  { key: "queued", label: "Queued", hint: "Waiting for a free download slot" },
  { key: "errored", label: "Errored", hint: "Something went wrong" },
];

const running = (t: Torrent) => t.state !== "stopped" && t.state !== "errored" && t.state !== "queued";

/** Paused or queued: the primary action is "Resume" (queued = start now). */
export const needsStart = (t: Torrent) => t.state === "stopped" || t.state === "queued";
const active = (t: Torrent) => running(t) && (t.downBps > 0 || t.upBps > 0);
const stalledDown = (t: Torrent) => t.state === "downloading" && t.downBps === 0;
const stalledUp = (t: Torrent) => t.state === "seeding" && t.upBps === 0;

export function matchStatus(t: Torrent, k: StatusKey): boolean {
  switch (k) {
    case "all":
      return true;
    case "downloading":
      return t.state === "downloading";
    case "seeding":
      return t.state === "seeding";
    case "completed":
      return t.finished || t.progress >= 1;
    case "running":
      return running(t);
    case "stopped":
      return t.state === "stopped";
    case "active":
      return active(t);
    case "inactive":
      return running(t) && !active(t);
    case "stalled":
      return stalledDown(t) || stalledUp(t);
    case "stalled_uploading":
      return stalledUp(t);
    case "stalled_downloading":
      return stalledDown(t);
    case "checking":
      return t.state === "checking";
    case "queued":
      return t.state === "queued";
    case "errored":
      return t.state === "errored";
  }
}

/** `null` = All, `""` = none (uncategorised / untagged / trackerless) */
export interface Filter {
  status: StatusKey;
  category: string | null;
  tag: string | null;
  tracker: string | null;
  kind: string | null;
}

export const KINDS: { key: string; label: string; icon: string }[] = [
  { key: "videos", label: "Videos", icon: "M8 5v14l11-7z" },
  { key: "music", label: "Music", icon: "M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z" },
  { key: "documents", label: "Documents", icon: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6" },
  { key: "images", label: "Images", icon: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01" },
  { key: "archives", label: "Archives", icon: "M4 7h16v13H4zM3 4h18v3H3zM10 12h4" },
  { key: "apps", label: "Apps & games", icon: "M6 3h12v18H6zM10 7h4M10 17h4" },
  { key: "other", label: "Other", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

export const NO_FILTER: Filter = { status: "all", category: null, tag: null, tracker: null, kind: null };

export function matches(t: Torrent, f: Filter): boolean {
  if (!matchStatus(t, f.status)) return false;
  if (f.kind !== null && t.kind !== f.kind) return false;
  if (f.category !== null && (t.category ?? "") !== f.category) return false;
  if (f.tag !== null) {
    if (f.tag === "" ? t.tags.length > 0 : !t.tags.includes(f.tag)) return false;
  }
  if (f.tracker !== null) {
    const hosts = t.trackers.map(hostOf);
    if (f.tracker === "" ? hosts.length > 0 : !hosts.includes(f.tracker)) return false;
  }
  return true;
}

export function isFiltered(f: Filter): boolean {
  return f.status !== "all" || f.category !== null || f.tag !== null || f.tracker !== null || f.kind !== null;
}

/** Human label for the current status text shown per row. */
export function statusLabel(t: Torrent): string {
  switch (t.state) {
    case "checking":
      return "Checking";
    case "errored":
      return "Error";
    case "queued":
      return "Queued";
    case "stopped":
      return t.finished ? "Completed" : "Stopped";
    case "seeding":
      return stalledUp(t) ? "Seeding (idle)" : "Seeding";
    case "downloading":
      return stalledDown(t) ? "Stalled" : "Downloading";
  }
}
