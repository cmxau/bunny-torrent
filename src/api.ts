import { invoke } from "@tauri-apps/api/core";

type EngineState = "checking" | "downloading" | "seeding" | "stopped" | "errored" | "queued";

export interface Torrent {
  id: number;
  hash: string;
  name: string;
  state: EngineState;
  finished: boolean;
  progress: number;
  totalBytes: number;
  downloadedBytes: number;
  uploadedBytes: number;
  downBps: number;
  upBps: number;
  etaSecs: number | null;
  knownPeers: number;
  peers: number;
  error: string | null;
  kind: string;
  category: string | null;
  tags: string[];
  addedOn: number;
  completedOn: number;
  activeSecs: number;
  savePath: string;
  trackers: string[];
  /** position in the download queue (lower starts first) */
  queuePos: number;
}

export interface ScheduleRule {
  /** bit0 = Monday ... bit6 = Sunday */
  days: number;
  /** minutes since local midnight; end < start wraps past midnight */
  startMin: number;
  endMin: number;
  /** 0 = unlimited in this window */
  dlLimitKib: number;
  ulLimitKib: number;
}

export interface Category {
  name: string;
  savePath: string | null;
}

export interface WatchFolder {
  path: string;
  category: string | null;
  paused: boolean;
  enabled: boolean;
}

export interface FeedFilter {
  include: string;
  exclude: string;
  regex: boolean;
  enabled: boolean;
}

export interface Feed {
  id: string;
  name: string;
  url: string;
  intervalMins: number;
  enabled: boolean;
  category: string | null;
  paused: boolean;
  addExisting: boolean;
  filters: FeedFilter[];
}

export interface FeedStatus {
  lastChecked: number;
  lastError: string | null;
  addedTotal: number;
  recent: { title: string; at: number }[];
}

export interface WatchStatus {
  lastScan: number;
  lastError: string | null;
  addedTotal: number;
}

export interface FeedTestResult {
  title: string;
  items: { title: string; link: string | null; matches: boolean }[];
  filterErrors: string[];
}

export interface Settings {
  watchFolders: WatchFolder[];
  feeds: Feed[];
  downloadDir: string;
  dlLimitKib: number;
  ulLimitKib: number;
  peerLimit: number;
  listenPort: number;
  dht: boolean;
  upnp: boolean;
  autoTrackers: boolean;
  startPaused: boolean;
  handleMagnets: boolean;
  sortByType: boolean;
  autoUpdate: boolean;
  typeFolders: Record<string, string>;
  searchSources: string[];
  seedRatioLimit: number;
  seedTimeLimitMins: number;
  seedLimitAction: "pause" | "remove";
  maxActiveDownloads: number;
  scheduleEnabled: boolean;
  schedule: ScheduleRule[];
  blocklistUrl: string;
  closeToTray: boolean;
  startWithWindows: boolean;
  notifyOnComplete: boolean;
}

export interface Snapshot {
  torrents: Torrent[];
  diskFree: number;
  diskTotal: number;
  categories: Category[];
  tags: string[];
  trackerList: string[];
  searchHistory: string[];
  settings: Settings;
  feedStatus?: Record<string, FeedStatus>;
  watchStatus?: Record<string, WatchStatus>;
  restartRequired: boolean;
}

export interface FileOut {
  index: number;
  path: string;
  size: number;
  done: number;
  included: boolean;
  /** 0 = do not download, 1 = normal, 2 = high, 3 = maximum */
  priority: number;
}

interface PeerOut {
  addr: string;
  client: string | null;
  kind: string | null;
  downloaded: number;
  uploaded: number;
  errors: number;
}

export interface Details {
  files: FileOut[];
  peers: PeerOut[];
  pieceLen: number;
  pieces: number;
  comment: string | null;
  createdBy: string | null;
  createdOn: number | null;
  private: boolean;
}

export interface SearchResult {
  id: string;
  source: string;
  name: string;
  size: number;
  /** -1 = the source doesn't say */
  seeders: number;
  leechers: number;
  /** unix seconds, 0 = unknown */
  added: number;
  category: string | null;
  files: number | null;
  /** a magnet link or a .torrent URL, ready for the add flow */
  link: string;
}

export interface SearchResponse {
  results: SearchResult[];
  errors: { source: string; message: string }[];
}

export const SEARCH_SOURCES = [
  {
    id: "internet-archive",
    label: "Internet Archive",
    blurb: "A free library of public-domain films, music, books and software.",
  },
  {
    id: "apibay",
    label: "Pirate Bay index",
    blurb: "A large public torrent index. You are responsible for what you choose to download.",
  },
] as const;

export const sourceLabel = (id: string) => SEARCH_SOURCES.find((s) => s.id === id)?.label ?? id;

export interface Incoming {
  kind: "magnet" | "file";
  value: string;
}

export interface Preview {
  token: string;
  name: string;
  hash: string;
  totalBytes: number;
  files: { index: number; path: string; size: number }[];
  kind: string;
  suggestedPath: string;
  existingId: number | null;
}

interface ConfirmReq {
  token: string;
  /** file index -> 0 skip, 2 high, 3 maximum; normal files are left out */
  prios: Record<number, number>;
  savePath?: string;
  category?: string | null;
  tags?: string[];
  paused?: boolean;
}

export interface AddReq {
  magnet?: string;
  paths?: string[];
  savePath?: string;
  category?: string | null;
  tags?: string[];
  paused?: boolean;
  trackers?: string[];
}

export interface CreateReq {
  source: string;
  savePath?: string;
  trackers: string[];
  comment?: string;
  /** omit or 0 = automatic */
  pieceLengthKib?: number;
  startSeeding: boolean;
  category?: string | null;
}

export interface CreateResult {
  torrentPath: string;
  infoHash: string;
  magnet: string;
  name: string;
  totalBytes: number;
}

export const api = {
  createTorrent: (req: CreateReq) => invoke<CreateResult>("create_torrent", { req }),
  snapshot: () => invoke<Snapshot>("snapshot"),
  details: (id: number) => invoke<Details>("details", { id }),
  setFilePriority: (id: number, files: number[], priority: number) =>
    invoke<void>("set_file_priority", { id, files, priority }),
  add: (req: AddReq) => invoke<{ added: number; duplicates: number; unsorted: number }>("add", { req }),
  preview: (src: { magnet?: string; path?: string }) => invoke<Preview>("preview", src),
  dropPreview: (token: string) => invoke<void>("drop_preview", { token }),
  addPreviewed: (req: ConfirmReq) => invoke<void>("add_previewed", { req }),
  takeIncoming: () => invoke<Incoming[]>("take_incoming"),
  defaultHandlerStatus: () => invoke<boolean>("default_handler_status"),
  search: (query: string) => invoke<SearchResponse>("search", { query }),
  removeSearchHistory: (query: string) => invoke<void>("remove_search_history", { query }),
  clearSearchHistory: () => invoke<void>("clear_search_history"),
  pause: (ids: number[]) => invoke<void>("pause", { ids }),
  resume: (ids: number[]) => invoke<void>("resume", { ids }),
  queueMove: (ids: number[], to: "top" | "up" | "down" | "bottom") => invoke<void>("queue_move", { ids, to }),
  remove: (ids: number[], deleteFiles: boolean) => invoke<void>("remove", { ids, deleteFiles }),
  setCategory: (ids: number[], category: string | null) =>
    invoke<void>("set_category", { ids, category }),
  setTags: (ids: number[], tags: string[]) => invoke<void>("set_tags", { ids, tags }),
  createCategory: (name: string, savePath?: string) =>
    invoke<void>("create_category", { name, savePath }),
  deleteCategory: (name: string) => invoke<void>("delete_category", { name }),
  createTag: (name: string) => invoke<void>("create_tag", { name }),
  deleteTag: (name: string) => invoke<void>("delete_tag", { name }),
  addTrackerList: (urls: string[]) => invoke<number>("add_tracker_list", { urls }),
  removeTrackerList: (url: string) => invoke<void>("remove_tracker_list", { url }),
  saveSettings: (settings: Settings) => invoke<boolean>("save_settings", { settings }),
  feedCheckNow: (id: string) => invoke<{ fetched: number; matched: number; added: number }>("feed_check_now", { id }),
  feedTest: (url: string, filters: FeedFilter[]) => invoke<FeedTestResult>("feed_test", { url, filters }),
  openFolder: (path?: string) => invoke<void>("open_folder", { path }),
};

export const errText = (e: unknown) => (typeof e === "string" ? e : (e as Error)?.message ?? String(e));

// ------------------------------------------------------------------ formatting

export function fmtBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

export const fmtSpeed = (n: number) => `${fmtBytes(n)}/s`;

export function fmtTime(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s} sec`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} sec`;
  const h = Math.floor(s / 3600);
  if (h < 48) return `${h} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function fmtShort(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function fmtDate(unix: number): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "just now", "5 min ago", "3 h ago", or a date. unix seconds; 0 = never. */
export function fmtAgo(unix: number): string {
  if (!unix) return "never";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(unix);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export const PRIORITIES = [
  { value: 0, label: "Do not download" },
  { value: 1, label: "Normal" },
  { value: 2, label: "High" },
  { value: 3, label: "Maximum" },
] as const;

export function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  if (h < 48) return `${h}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
