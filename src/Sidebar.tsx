import { useMemo, useState, type ReactNode } from "react";
import { hostOf, type Snapshot } from "./api";
import { KINDS, matchStatus, STATUSES, type Filter, type StatusKey } from "./filters";
import { GROUPS, MORE_STATUSES, OVERVIEW_STATUSES, type GroupId } from "./sidebarItems";
import { Icon, P } from "./ui";

const EYE = "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z";
const EYE_OFF = "M4 4l16 16M10.6 6.2A9.6 9.6 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3 3.5M6.5 7.5C3.6 9.3 2 12 2 12s4 7 10 7c1.5 0 2.8-.4 4-.9";

const OVERVIEW_ICONS: Record<string, string> = {
  all: P.list,
  downloading: P.down,
  seeding: P.up,
  completed: P.folder,
};

export function Sidebar({
  snap,
  filter,
  setFilter,
  onAddCategory,
  onAddTag,
  onAddTrackers,
  onDeleteCategory,
  onDeleteTag,
  onRemoveTracker,
  view,
  onOverview,
  settingsOpen,
  openSettings,
  hidden,
  toggleHidden,
  showAll,
  editing,
  setEditing,
}: {
  snap: Snapshot | null;
  filter: Filter;
  setFilter: (f: Filter) => void;
  onAddCategory: () => void;
  onAddTag: () => void;
  onAddTrackers: () => void;
  onDeleteCategory: (n: string) => void;
  onDeleteTag: (n: string) => void;
  onRemoveTracker: (u: string) => void;
  view: "overview" | "torrents" | "settings";
  onOverview: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  hidden: Set<string>;
  toggleHidden: (id: string) => void;
  showAll: () => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const torrents = snap?.torrents ?? [];

  const statusCounts = useMemo(
    () => Object.fromEntries(STATUSES.map((s) => [s.key, torrents.filter((t) => matchStatus(t, s.key)).length])),
    [torrents],
  );
  const kindCount = (k: string) => torrents.filter((t) => t.kind === k).length;
  const catCount = (c: string) => torrents.filter((t) => (t.category ?? "") === c).length;
  const tagCount = (g: string) => torrents.filter((t) => (g === "" ? t.tags.length === 0 : t.tags.includes(g))).length;
  const hosts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of torrents) for (const h of new Set(t.trackers.map(hostOf))) m.set(h, (m.get(h) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [torrents]);
  const trackerless = torrents.filter((t) => t.trackers.length === 0).length;

  const isHidden = (id: string) => hidden.has(id);
  const visible = (id: string) => editing || !isHidden(id);
  // filters only look selected while the torrent table is on screen
  const idle = settingsOpen || view !== "torrents";

  const item = (opts: {
    id: string;
    label: string;
    count: number;
    active: boolean;
    onClick: () => void;
    icon?: string;
    extra?: ReactNode;
    hint?: string;
  }) => {
    if (!visible(opts.id)) return null;
    if (editing) {
      const off = isHidden(opts.id);
      return (
        <div key={opts.id} className={`nav editing ${off ? "off" : ""}`}>
          {opts.icon && <Icon d={opts.icon} size={16} />}
          <span className="lbl">{opts.label}</span>
          <button className="eye" onClick={() => toggleHidden(opts.id)} aria-label={`${off ? "Show" : "Hide"} ${opts.label}`} title={off ? "Show in sidebar" : "Hide from sidebar"}>
            <Icon d={off ? EYE_OFF : EYE} size={16} />
          </button>
        </div>
      );
    }
    return (
      <button
        key={opts.id}
        className={`nav ${opts.active ? "active" : ""} ${opts.count === 0 && !opts.active ? "zero" : ""}`}
        onClick={opts.onClick}
        title={opts.hint}
      >
        {opts.icon && <Icon d={opts.icon} size={16} />}
        <span className="lbl">{opts.label}</span>
        {opts.extra}
        <em className={opts.active ? "hl" : ""}>{opts.count}</em>
      </button>
    );
  };

  const del = (title: string, fn: () => void) => (
    <span
      className="del"
      role="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        fn();
      }}
    >
      <Icon d={P.close} size={12} />
    </span>
  );

  const group = (g: GroupId, body: ReactNode, onAdd?: () => void, addTitle?: string) => {
    const id = `group:${g}`;
    if (!visible(id)) return null;
    const meta = GROUPS.find((x) => x.id === g)!;
    const off = isHidden(id);
    return (
      <section key={g} className={`sgroup ${editing && off ? "off" : ""}`}>
        <div className="ghead">
          <button className="gtoggle" onClick={() => setShut({ ...shut, [g]: !shut[g] })} aria-expanded={!shut[g]}>
            <span className={`caret ${shut[g] ? "" : "open"}`}>
              <Icon d={P.chevR} size={12} />
            </span>
            {meta.label.toUpperCase()}
          </button>
          {editing ? (
            <button className="eye" onClick={() => toggleHidden(id)} aria-label={`${off ? "Show" : "Hide"} ${meta.label} section`} title={off ? "Show this section" : "Hide this section"}>
              <Icon d={off ? EYE_OFF : EYE} size={16} />
            </button>
          ) : (
            onAdd && (
              <button className="gadd" onClick={onAdd} title={addTitle} aria-label={addTitle}>
                <Icon d={P.plus} size={14} />
              </button>
            )
          )}
        </div>
        {(editing || !shut[g]) && !(editing && off) && body}
      </section>
    );
  };

  const statusItem = (k: StatusKey, label?: string) => {
    const s = STATUSES.find((x) => x.key === k)!;
    return item({
      id: `status:${k}`,
      label: label ?? s.label,
      count: statusCounts[k] ?? 0,
      active: !idle && filter.status === k,
      onClick: () => setFilter({ ...filter, status: k }),
      icon: OVERVIEW_ICONS[k],
      hint: s.hint,
    });
  };

  return (
    <aside className="sidebar">
      <div className="sbscroll">
        {editing && (
          <div className="editbar">
            <b>Customize sidebar</b>
            <small>Use the eye to hide or show a section or item. Hidden items can come back any time.</small>
            <div>
              <button className="ghost" onClick={showAll}>
                Show everything
              </button>
              <button className="ghost primary" onClick={() => setEditing(false)}>
                Done
              </button>
            </div>
          </div>
        )}

        {group(
          "overview",
          <>
            {item({
              id: "view:overview",
              label: "Overview",
              count: torrents.length,
              active: view === "overview",
              onClick: onOverview,
              icon: P.home,
              hint: "Totals, search and recent torrents",
            })}
            {OVERVIEW_STATUSES.map((k) => statusItem(k, k === "all" ? "All torrents" : undefined))}
          </>,
        )}

        {group(
          "explorer",
          <>
            {KINDS.map((k) =>
              item({
                id: `kind:${k.key}`,
                label: k.label,
                count: kindCount(k.key),
                active: !idle && filter.kind === k.key,
                onClick: () => setFilter({ ...filter, kind: filter.kind === k.key ? null : k.key }),
                icon: k.icon,
              }),
            )}
          </>,
        )}

        {group("status", <>{MORE_STATUSES.map((s) => statusItem(s.key))}</>)}

        {group(
          "categories",
          <>
            {!editing &&
              item({
                id: "cat:*all",
                label: "All",
                count: torrents.length,
                active: !idle && filter.category === null,
                onClick: () => setFilter({ ...filter, category: null }),
              })}
            {item({
              id: "cat:",
              label: "Uncategorised",
              count: catCount(""),
              active: !idle && filter.category === "",
              onClick: () => setFilter({ ...filter, category: "" }),
            })}
            {snap?.categories.map((c) =>
              item({
                id: `cat:${c.name}`,
                label: c.name,
                count: catCount(c.name),
                active: !idle && filter.category === c.name,
                onClick: () => setFilter({ ...filter, category: c.name }),
                extra: del("Delete category", () => onDeleteCategory(c.name)),
                hint: c.savePath ?? undefined,
              }),
            )}
          </>,
          onAddCategory,
          "New category",
        )}

        {group(
          "tags",
          <>
            {!editing &&
              item({
                id: "tag:*all",
                label: "All",
                count: torrents.length,
                active: !idle && filter.tag === null,
                onClick: () => setFilter({ ...filter, tag: null }),
              })}
            {item({
              id: "tag:",
              label: "Untagged",
              count: tagCount(""),
              active: !idle && filter.tag === "",
              onClick: () => setFilter({ ...filter, tag: "" }),
            })}
            {snap?.tags.map((g) =>
              item({
                id: `tag:${g}`,
                label: g,
                count: tagCount(g),
                active: !idle && filter.tag === g,
                onClick: () => setFilter({ ...filter, tag: g }),
                extra: del("Delete tag", () => onDeleteTag(g)),
              }),
            )}
          </>,
          onAddTag,
          "New tag",
        )}

        {group(
          "trackers",
          <>
            {!editing &&
              item({
                id: "trk:*all",
                label: "All",
                count: torrents.length,
                active: !idle && filter.tracker === null,
                onClick: () => setFilter({ ...filter, tracker: null }),
              })}
            {item({
              id: "trk:",
              label: "Trackerless",
              count: trackerless,
              active: !idle && filter.tracker === "",
              onClick: () => setFilter({ ...filter, tracker: "" }),
            })}
            {hosts.map(([h, n]) =>
              item({
                id: `trk:${h}`,
                label: h,
                count: n,
                active: !idle && filter.tracker === h,
                onClick: () => setFilter({ ...filter, tracker: h }),
              }),
            )}
            {!editing && (snap?.trackerList.length ?? 0) > 0 && (
              <div className="sublist">
                <small>Saved list (added to new torrents)</small>
                {snap!.trackerList.map((u) => (
                  <div key={u} className="trk" title={u}>
                    <span>{hostOf(u)}</span>
                    {del("Remove from list", () => onRemoveTracker(u))}
                  </div>
                ))}
              </div>
            )}
          </>,
          onAddTrackers,
          "Add trackers to list",
        )}

        {!editing && GROUPS.every((g) => isHidden(`group:${g.id}`)) && (
          <div className="allhidden">
            Everything is hidden.
            <button className="lnk" onClick={() => setEditing(true)}>
              Customize sidebar
            </button>
          </div>
        )}
      </div>

      <div className="sbfoot">
        <button className={`nav ${settingsOpen ? "active" : ""}`} onClick={openSettings}>
          <Icon d={P.sliders} />
          <span className="lbl">Settings</span>
        </button>
      </div>
    </aside>
  );
}
