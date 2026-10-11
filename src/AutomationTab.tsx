import { useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText, fmtAgo, type Feed, type FeedFilter, type FeedTestResult, type Settings, type Snapshot } from "./api";
import { Icon, P, Toggle } from "./ui";

function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="srow">
      <div className="stext">
        <b>{title}</b>
        {desc && <small>{desc}</small>}
      </div>
      <div className="sctl">{children}</div>
    </div>
  );
}

const NEW_FILTER: FeedFilter = { include: "", exclude: "", regex: false, enabled: true };

function CategorySelect({ value, cats, onChange }: { value: string | null; cats: Snapshot["categories"]; onChange: (v: string | null) => void }) {
  const known = !value || cats.some((c) => c.name === value);
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Category">
      <option value="">Uncategorised</option>
      {!known && <option value={value!}>{value}</option>}
      {cats.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function FeedCard({
  feed,
  saved,
  snap,
  expanded,
  toggleOpen,
  set,
  remove,
  flash,
  refresh,
}: {
  feed: Feed;
  saved: Feed | undefined;
  snap: Snapshot;
  expanded: boolean;
  toggleOpen: () => void;
  set: (p: Partial<Feed>) => void;
  remove: () => void;
  flash: (m: string) => void;
  refresh: () => void;
}) {
  const [test, setTest] = useState<FeedTestResult | null>(null);
  const [testErr, setTestErr] = useState("");
  const [testing, setTesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const filters = feed.filters ?? [];
  const st = snap.feedStatus?.[feed.id];
  const clean = !!saved && JSON.stringify(saved) === JSON.stringify(feed);
  const setFilter = (i: number, p: Partial<FeedFilter>) => set({ filters: filters.map((f, j) => (j === i ? { ...f, ...p } : f)) });

  const runTest = async () => {
    setTesting(true);
    setTestErr("");
    setTest(null);
    try {
      setTest(await api.feedTest(feed.url.trim(), filters));
    } catch (e) {
      setTestErr(errText(e));
    } finally {
      setTesting(false);
    }
  };
  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await api.feedCheckNow(feed.id);
      flash(`Added ${r.added} of ${r.matched} matching item${r.matched === 1 ? "" : "s"}`);
      refresh();
    } catch (e) {
      flash(errText(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="listbox feedcard">
      <div className="listhead2">
        <button className="ghost" onClick={toggleOpen} aria-expanded={expanded} title={expanded ? "Collapse" : "Edit this feed"}>
          {expanded ? "▾" : "▸"} <b>{feed.name || "Untitled feed"}</b>
        </button>
        <div className="inrow">
          <Toggle on={feed.enabled} onChange={(v) => set({ enabled: v })} label={`Check ${feed.name || "this feed"}`} />
          <button className="x" onClick={remove} aria-label="Remove feed">
            <Icon d={P.trash} size={14} />
          </button>
        </div>
      </div>
      <small className="blurb">
        {!saved ? "Not saved yet. Save changes to start checking it." : st ? `Last checked ${fmtAgo(st.lastChecked)} · ${st.addedTotal} added in total` : "Not checked yet"}
      </small>
      {st?.lastError && <div className="err">{st.lastError}</div>}
      {st && st.recent?.length > 0 && (
        <small className="blurb">
          Recently added: {st.recent.slice(0, 3).map((r) => r.title).join(" · ")}
        </small>
      )}

      {expanded && (
        <div className="feededit">
          <Row title="Name">
            <div className="inrow wide">
              <input value={feed.name} placeholder="My feed" onChange={(e) => set({ name: e.target.value })} />
            </div>
          </Row>
          <Row title="Feed address" desc="The link to the RSS or Atom feed.">
            <div className="inrow wide">
              <input value={feed.url} placeholder="https://example.com/feed.xml" onChange={(e) => set({ url: e.target.value })} />
            </div>
          </Row>
          <Row title="Check every" desc="At least 5 minutes.">
            <div className="numin">
              <input type="number" min={5} value={feed.intervalMins} onChange={(e) => set({ intervalMins: Math.max(5, Math.floor(Number(e.target.value) || 5)) })} />
              <span>minutes</span>
            </div>
          </Row>
          <Row title="Category for new torrents">
            <CategorySelect value={feed.category} cats={snap.categories} onChange={(v) => set({ category: v })} />
          </Row>
          <Row title="Add paused" desc="Matching torrents wait in the list until you resume them.">
            <Toggle on={feed.paused} onChange={(v) => set({ paused: v })} label="Add paused" />
          </Row>
          <Row title="Also add matching items already in the feed" desc="Off: the first check only notes what is already there, and only later items are added.">
            <Toggle on={feed.addExisting} onChange={(v) => set({ addExisting: v })} label="Also add matching items already in the feed" />
          </Row>

          <div className="listhead2 fhead">
            <b>Filters</b>
            <button className="ghost" onClick={() => set({ filters: [...filters, { ...NEW_FILTER }] })}>
              <Icon d={P.plus} size={13} /> Add filter
            </button>
          </div>
          {filters.length === 0 && <em className="faint">No filters yet, so this feed adds nothing. Add one to choose what to download.</em>}
          {filters.map((f, i) => (
            <div className="li filt" key={i}>
              <input value={f.include} placeholder={f.regex ? "Include (regular expression)" : "Must contain all of these words"} onChange={(e) => setFilter(i, { include: e.target.value })} aria-label="Include" />
              <input value={f.exclude} placeholder={f.regex ? "Exclude (regular expression)" : "Must not contain"} onChange={(e) => setFilter(i, { exclude: e.target.value })} aria-label="Exclude" />
              <label className="filtopt">
                <Toggle on={f.regex} onChange={(v) => setFilter(i, { regex: v })} label="Regular expression" /> Regular expression
              </label>
              <Toggle on={f.enabled} onChange={(v) => setFilter(i, { enabled: v })} label="Filter enabled" />
              <button className="x" onClick={() => set({ filters: filters.filter((_, j) => j !== i) })} aria-label="Remove filter">
                <Icon d={P.trash} size={14} />
              </button>
            </div>
          ))}
          <p className="note">
            An item is added only if it matches at least one enabled filter. In a filter, every include word must appear in the title and no exclude word may appear. In regular expression mode, include and exclude are regular expressions.
          </p>

          <div className="inrow">
            <button className="ghost" disabled={testing || !feed.url.trim()} onClick={runTest}>
              {testing ? "Testing…" : "Test feed"}
            </button>
            <button className="ghost" disabled={checking || !clean} onClick={checkNow} title={clean ? "" : "Save your changes first"}>
              {checking ? "Checking…" : "Check now"}
            </button>
            {!clean && <small className="blurb">{saved ? "Save your changes to check now." : "Save the feed to check now."}</small>}
          </div>
          {testErr && <div className="err">{testErr}</div>}
          {test && (
            <div className="testout">
              <b>{test.title || "Feed"}</b>
              {(test.filterErrors ?? []).map((m, i) => (
                <div className="err" key={i}>
                  {m}
                </div>
              ))}
              {(test.items ?? []).length === 0 && <em className="faint">The feed has no items.</em>}
              <div className="testlist">
                {(test.items ?? []).slice(0, 50).map((it, i) => (
                  <div className="li" key={i}>
                    <span title={it.title}>
                      {it.matches ? "✓ " : ""}
                      {it.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AutomationTab({
  snap,
  draft,
  up,
  flash,
  refresh,
}: {
  snap: Snapshot;
  draft: Settings;
  up: (p: Partial<Settings>) => void;
  flash: (m: string) => void;
  refresh: () => void;
}) {
  const folders = draft.watchFolders ?? [];
  const feeds = draft.feeds ?? [];
  const savedFeeds = snap.settings.feeds ?? [];
  const [openId, setOpenId] = useState<string | null>(null);

  const setFolder = (i: number, p: Partial<(typeof folders)[number]>) => up({ watchFolders: folders.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const addFolder = async () => {
    const r = await open({ directory: true });
    if (typeof r === "string" && !folders.some((f) => f.path === r)) up({ watchFolders: [...folders, { path: r, category: null, paused: false, enabled: true }] });
  };
  const addFeed = () => {
    const id = String(Date.now());
    up({ feeds: [...feeds, { id, name: "New feed", url: "", intervalMins: 30, enabled: true, category: null, paused: false, addExisting: false, filters: [] }] });
    setOpenId(id);
  };

  return (
    <>
      <div className="listbox">
        <div className="listhead2">
          <div>
            <b>Watch folders</b>
            <small className="blurb">Any .torrent file dropped into a watched folder is added automatically. The file is then renamed to .torrent.added.</small>
          </div>
          <button className="ghost" onClick={addFolder}>
            <Icon d={P.plus} size={13} /> Add folder…
          </button>
        </div>
        {folders.length === 0 && <em className="faint">No folders yet.</em>}
        {folders.map((f, i) => {
          const st = snap.watchStatus?.[f.path];
          return (
            <div className="watchrow" key={f.path}>
              <div className="li">
                <span title={f.path}>{f.path}</span>
                <div className="inrow">
                  <CategorySelect value={f.category} cats={snap.categories} onChange={(v) => setFolder(i, { category: v })} />
                  <label className="filtopt">
                    <Toggle on={f.paused} onChange={(v) => setFolder(i, { paused: v })} label="Add paused" /> Add paused
                  </label>
                  <Toggle on={f.enabled} onChange={(v) => setFolder(i, { enabled: v })} label="Watch this folder" />
                  <button className="x" onClick={() => up({ watchFolders: folders.filter((_, j) => j !== i) })} aria-label="Remove folder">
                    <Icon d={P.trash} size={14} />
                  </button>
                </div>
              </div>
              {st?.lastError ? (
                <div className="err">{st.lastError}</div>
              ) : (
                <small className="blurb">{st && st.lastScan ? `Last scan ${fmtAgo(st.lastScan)} · ${st.addedTotal} added` : "Not scanned yet"}</small>
              )}
            </div>
          );
        })}
      </div>

      <div className="listbox">
        <div className="listhead2">
          <div>
            <b>RSS feeds</b>
            <small className="blurb">Check a feed regularly and add new items that match your filters.</small>
          </div>
          <button className="ghost" onClick={addFeed}>
            <Icon d={P.plus} size={13} /> Add feed
          </button>
        </div>
        <p className="note">Feeds with no filters add nothing, so give each feed at least one filter.</p>
        {feeds.length === 0 && <em className="faint">No feeds yet.</em>}
        {feeds.map((fd) => (
          <FeedCard
            key={fd.id}
            feed={fd}
            saved={savedFeeds.find((x) => x.id === fd.id)}
            snap={snap}
            expanded={openId === fd.id}
            toggleOpen={() => setOpenId(openId === fd.id ? null : fd.id)}
            set={(p) => up({ feeds: feeds.map((x) => (x.id === fd.id ? { ...x, ...p } : x)) })}
            remove={() => up({ feeds: feeds.filter((x) => x.id !== fd.id) })}
            flash={flash}
            refresh={refresh}
          />
        ))}
      </div>
    </>
  );
}
