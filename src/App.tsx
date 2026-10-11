import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, type Torrent } from "./api";
import { matches, needsStart, NO_FILTER, type Filter } from "./filters";
import { Sidebar } from "./Sidebar";
import { DetailsPanel } from "./Details";
import { SettingsPage } from "./Settings";
import { AddDialog, ConfirmDialog, ListDialogs, type AddInitial, type Confirm } from "./Dialogs";
import { PreviewDialog } from "./Preview";
import { CreateDialog } from "./CreateDialog";
import { FilterMenu } from "./FilterMenu";
import { Overview } from "./Overview";
import { useUpdater } from "./updater";
import { COLUMNS, loadCols, type ColKey } from "./columns";
import { store } from "./storage";
import { TitleBar } from "./TitleBar";
import { ListHead } from "./ListHead";
import { TorrentTable, type Sort } from "./TorrentTable";
import { ColumnMenu, TorrentMenu, type MenuPos } from "./TorrentMenus";
import { StatsPanel } from "./StatsPanel";
import { usePolling } from "./usePolling";
import { useIncoming } from "./useIncoming";
import { useHiddenItems } from "./useHiddenItems";

type View = "overview" | "torrents" | "settings";

export default function App() {
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [view, setView] = useState<View>("overview");
  const lastView = useRef<"overview" | "torrents">("overview");
  const viewRef = useRef<View>("overview");
  const [showRecent, setShowRecent] = useState(store.get("showRecent", "1") === "1");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "added", dir: -1 });
  const [cols, setCols] = useState<ColKey[]>(() => loadCols(store.get("cols", "null")));
  const [filterMenu, setFilterMenu] = useState<MenuPos | null>(null);
  const [editingSidebar, setEditingSidebar] = useState(false);
  const [colMenu, setColMenu] = useState<MenuPos | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dark, setDark] = useState(store.get("dark", "1") === "1");
  const [toast, setToast] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<AddInitial | null>(null);
  const [dialog, setDialog] = useState<null | "category" | "tag" | "trackers">(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [menu, setMenu] = useState<(MenuPos & { id: number }) | null>(null);
  const [series, setSeries] = useState({ d: true, u: true });
  const [started] = useState(Date.now());
  const search = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number>();

  const { snap, poll, histRef, perTorrent, base } = usePolling(viewRef);
  const hist = histRef.current;
  const { hidden, toggleHidden, showAll } = useHiddenItems(filter, setFilter);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    store.set("dark", dark ? "1" : "0");
  }, [dark]);
  useEffect(() => store.set("cols", JSON.stringify(cols)), [cols]);
  useEffect(() => store.set("showRecent", showRecent ? "1" : "0"), [showRecent]);
  useEffect(() => {
    viewRef.current = view;
    if (view !== "settings") lastView.current = view;
  }, [view]);

  const activeCols = useMemo(() => COLUMNS.filter((c) => cols.includes(c.key)), [cols]);

  const flash = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const updater = useUpdater({
    auto: snap?.settings.autoUpdate ?? false,
    downloading: (snap?.torrents ?? []).some((t) => t.state === "downloading"),
    flash,
  });
  const { dragging, queue, setQueue, enqueue, browse } = useIncoming(filter, flash, poll);

  const onAddResult = useCallback((r: { link: string; name: string }) => enqueue([{ magnet: r.link, title: r.name }]), [enqueue]);

  // in-app completion toast (the OS notification comes from the backend)
  const prev = useRef(new Map<number, string>());
  useEffect(() => {
    if (!snap) return;
    for (const t of snap.torrents) {
      const p = prev.current.get(t.id);
      if (p === "downloading" && t.finished) {
        flash(`Finished: ${t.name}`);
      }
      prev.current.set(t.id, t.state);
    }
  }, [snap, flash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setSelected(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (viewRef.current === "overview") document.querySelector<HTMLInputElement>(".obar input")?.focus();
        else search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ------------------------------------------------------------ list

  const torrents = snap?.torrents ?? [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = torrents.filter((t) => matches(t, filter) && (!q || t.name.toLowerCase().includes(q)));
    return list.sort((a, b) => {
      const col = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0];
      const x = col.sort(a);
      const y = col.sort(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [torrents, filter, query, sort]);

  const sel = torrents.find((t) => t.id === selected) ?? null;
  useEffect(() => {
    if (selected !== null && !sel && snap) setSelected(null);
  }, [selected, sel, snap]);

  const act = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      flash(errText(e));
    }
    poll();
  };

  const toggleRun = (t: Torrent) => act(() => (needsStart(t) ? api.resume([t.id]) : api.pause([t.id])));

  const askRemove = (t: Torrent, files: boolean) =>
    setConfirm({
      title: files ? "Remove and delete files?" : "Remove torrent?",
      body: files
        ? `“${t.name}” will be removed and its downloaded files deleted from disk. This can’t be undone.`
        : `“${t.name}” will be removed from the list. Downloaded files stay on your disk.`,
      action: files ? "Remove and delete" : "Remove",
      run: () => api.remove([t.id], files),
    });

  const title = (() => {
    const parts: string[] = [];
    if (filter.status !== "all") parts.push(filter.status.replace(/_/g, " "));
    if (filter.kind !== null) parts.push(filter.kind);
    if (filter.category !== null) parts.push(filter.category || "uncategorised");
    if (filter.tag !== null) parts.push(filter.tag ? `#${filter.tag}` : "untagged");
    if (filter.tracker !== null) parts.push(filter.tracker || "trackerless");
    return parts.length ? parts.join(" · ") : "All torrents";
  })();

  const menuT = menu ? torrents.find((t) => t.id === menu.id) : null;

  return (
    <div className="app" onClick={() => menu && setMenu(null)}>
      <TitleBar />

      <Sidebar
        snap={snap}
        filter={filter}
        setFilter={(f) => {
          setFilter(f);
          setView("torrents");
        }}
        onAddCategory={() => setDialog("category")}
        onAddTag={() => setDialog("tag")}
        onAddTrackers={() => setDialog("trackers")}
        onDeleteCategory={(n) =>
          setConfirm({
            title: `Delete category “${n}”?`,
            body: "Torrents in it become uncategorised. Their files aren’t touched.",
            action: "Delete",
            run: async () => {
              await api.deleteCategory(n);
              if (filter.category === n) setFilter({ ...filter, category: null });
            },
          })
        }
        onDeleteTag={(n) =>
          setConfirm({
            title: `Delete tag “${n}”?`,
            body: "It will be removed from every torrent that has it.",
            action: "Delete",
            run: async () => {
              await api.deleteTag(n);
              if (filter.tag === n) setFilter({ ...filter, tag: null });
            },
          })
        }
        onRemoveTracker={(u) => act(() => api.removeTrackerList(u))}
        view={view}
        onOverview={() => {
          setFilter(NO_FILTER);
          setQuery("");
          setView("overview");
        }}
        settingsOpen={view === "settings"}
        openSettings={() => setView(view === "settings" ? lastView.current : "settings")}
        hidden={hidden}
        toggleHidden={toggleHidden}
        showAll={showAll}
        editing={editingSidebar}
        setEditing={setEditingSidebar}
      />

      <main className="content">
        {view === "settings" && snap && (
          <SettingsPage
            snap={snap}
            refresh={poll}
            flash={flash}
            dark={dark}
            setDark={setDark}
            onAddTrackers={() => setDialog("trackers")}
            onAddCategory={() => setDialog("category")}
            onAddTag={() => setDialog("tag")}
            onDeleteCategory={(n) => act(() => api.deleteCategory(n))}
            onDeleteTag={(n) => act(() => api.deleteTag(n))}
            showRecent={showRecent}
            setShowRecent={setShowRecent}
            update={updater.state}
            checkUpdate={() => updater.checkNow(false)}
            installUpdate={updater.install}
            hidden={hidden}
            toggleHidden={toggleHidden}
            showAll={showAll}
            customize={() => {
              setView(lastView.current);
              setEditingSidebar(true);
            }}
          />
        )}

        {view === "overview" && snap && (
          <Overview
            snap={snap}
            showRecent={showRecent}
            setShowRecent={setShowRecent}
            onBrowse={browse}
            onCreate={() => setCreating(true)}
            onSeeAll={() => {
              setFilter(NO_FILTER);
              setView("torrents");
            }}
            onInfo={(id) => {
              setFilter(NO_FILTER);
              setQuery("");
              setView("torrents");
              setSelected(id);
            }}
            onToggle={toggleRun}
            onAddResult={onAddResult}
            refresh={poll}
            flash={flash}
          />
        )}

        {view === "torrents" && (
          <>
            <ListHead
              title={title}
              count={shown.length}
              filter={filter}
              setFilter={setFilter}
              query={query}
              setQuery={setQuery}
              searchRef={search}
              openFilterMenu={setFilterMenu}
              openColMenu={setColMenu}
              onCreate={() => setCreating(true)}
              onAdd={() => setAdding({ category: filter.category || null, tags: filter.tag ? [filter.tag] : [] })}
            />

            <TorrentTable
              torrents={torrents}
              shown={shown}
              cols={activeCols}
              sort={sort}
              setSort={setSort}
              selected={selected}
              onSelect={(id) => setSelected(id === selected ? null : id)}
              onMenu={(t, x, y) => {
                setSelected(t.id);
                setMenu({ x, y, id: t.id });
              }}
              onColMenu={(x, y) => setColMenu({ x, y })}
              onToggle={toggleRun}
              onRemove={(t) => askRemove(t, false)}
            />

            <div className="divider" />
            {sel && snap ? (
              <DetailsPanel
                t={sel}
                snap={snap}
                hist={perTorrent.current.get(sel.id)}
                session={base.current.get(sel.hash)}
                onClose={() => setSelected(null)}
                refresh={poll}
                flash={flash}
                onAddTrackers={() => setDialog("trackers")}
              />
            ) : (
              <StatsPanel torrents={torrents} hist={hist} series={series} setSeries={setSeries} started={started} />
            )}
          </>
        )}
      </main>

      {filterMenu && snap && (
        <FilterMenu
          snap={snap}
          filter={filter}
          setFilter={(f) => {
            setFilter(f);
            setView("torrents");
          }}
          x={filterMenu.x}
          y={filterMenu.y}
          onClose={() => setFilterMenu(null)}
        />
      )}

      {colMenu && <ColumnMenu pos={colMenu} cols={cols} setCols={setCols} close={() => setColMenu(null)} />}

      {menu && menuT && snap && (
        <TorrentMenu t={menuT} snap={snap} pos={menu} close={() => setMenu(null)} act={act} askRemove={askRemove} />
      )}

      {dragging && (
        <div className="dropveil">
          <div>Drop .torrent files to add them</div>
        </div>
      )}

      {adding && snap && (
        <AddDialog
          initial={adding}
          categories={snap.categories}
          tags={snap.tags}
          defaultPaused={snap.settings.startPaused}
          onClose={() => setAdding(null)}
          onDone={(m) => {
            setAdding(null);
            flash(m);
            poll();
          }}
          onPreview={(src) => {
            setAdding(null);
            enqueue([src]);
          }}
        />
      )}
      {creating && snap && (
        <CreateDialog
          categories={snap.categories}
          trackerList={snap.trackerList}
          onClose={() => setCreating(false)}
          onCreated={poll}
          flash={flash}
        />
      )}
      {queue[0] && snap && (
        <PreviewDialog
          key={queue[0].qid}
          source={queue[0]}
          categories={snap.categories}
          tags={snap.tags}
          defaultPaused={snap.settings.startPaused}
          more={queue.length - 1}
          onClose={() => setQueue((q) => q.slice(1))}
          onAdded={(m) => {
            setQueue((q) => q.slice(1));
            flash(m);
            poll();
          }}
          onExisting={(id) => {
            setQueue((q) => q.slice(1));
            setFilter(NO_FILTER);
            setView("torrents");
            setSelected(id);
            flash("That torrent is already in your list");
          }}
        />
      )}
      <ListDialogs dialog={dialog} trackerList={snap?.trackerList ?? []} onClose={() => setDialog(null)} flash={flash} poll={poll} />
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} run={act} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
