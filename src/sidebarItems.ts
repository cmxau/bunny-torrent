import { KINDS, STATUSES } from "./filters";

/** The groups in the sidebar, in display order. */
export const GROUPS = [
  { id: "overview", label: "Overview", blurb: "Quick views of your whole library" },
  { id: "explorer", label: "Explorer", blurb: "Browse by what’s inside — videos, music, documents…" },
  { id: "status", label: "Status", blurb: "Every state a torrent can be in" },
  { id: "categories", label: "Categories", blurb: "Your own categories" },
  { id: "tags", label: "Tags", blurb: "Your own tags" },
  { id: "trackers", label: "Trackers", blurb: "Group by tracker" },
] as const;
export type GroupId = (typeof GROUPS)[number]["id"];

/** Overview shows the four most-used views (same as the original design). */
export const OVERVIEW_STATUSES = ["all", "downloading", "seeding", "completed"] as const;

/** The remaining qBittorrent-style states live under STATUS so nothing is listed twice. */
export const MORE_STATUSES = STATUSES.filter((s) => !(OVERVIEW_STATUSES as readonly string[]).includes(s.key));

/** Fixed (non-dynamic) items a person can hide, shown in Settings → Sidebar. */
export const STATIC_ITEMS: { id: string; group: GroupId; label: string }[] = [
  { id: "view:overview", group: "overview", label: "Overview" },
  ...OVERVIEW_STATUSES.map((k) => ({
    id: `status:${k}`,
    group: "overview" as const,
    label: k === "all" ? "All torrents" : STATUSES.find((s) => s.key === k)!.label,
  })),
  ...KINDS.map((k) => ({ id: `kind:${k.key}`, group: "explorer" as const, label: k.label })),
  ...MORE_STATUSES.map((s) => ({ id: `status:${s.key}`, group: "status" as const, label: s.label })),
  { id: "cat:", group: "categories", label: "Uncategorised" },
  { id: "tag:", group: "tags", label: "Untagged" },
  { id: "trk:", group: "trackers", label: "Trackerless" },
];
