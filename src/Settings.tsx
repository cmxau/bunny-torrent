import { useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";
import { About } from "./About";
import { AutomationTab } from "./AutomationTab";
import type { UpdateState } from "./updater";
import { SEARCH_SOURCES, api, errText, hostOf, type ScheduleRule, type Settings as S, type Snapshot } from "./api";
import { Icon, P, Toggle } from "./ui";
import { GROUPS, STATIC_ITEMS } from "./sidebarItems";
import { KINDS } from "./filters";

const DEFAULT_FOLDER: Record<string, string> = {
  videos: "Videos",
  music: "Music",
  documents: "Documents",
  images: "Pictures",
  archives: "Archives",
  apps: "Apps",
  other: "Other",
};

type Tab = "general" | "sidebar" | "search" | "speed" | "queue" | "automation" | "connection" | "trackers" | "organise" | "about";
const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "sidebar", label: "Sidebar" },
  { key: "search", label: "Search" },
  { key: "speed", label: "Speed" },
  { key: "queue", label: "Queue & seeding" },
  { key: "automation", label: "Automation" },
  { key: "connection", label: "Connection" },
  { key: "trackers", label: "Trackers" },
  { key: "organise", label: "Categories & tags" },
  { key: "about", label: "About" },
];

function Row({
  title,
  desc,
  children,
  restart,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
  restart?: boolean;
}) {
  return (
    <div className="srow">
      <div className="stext">
        <b>
          {title}
          {restart && <span className="badge">needs restart</span>}
        </b>
        {desc && <small>{desc}</small>}
      </div>
      <div className="sctl">{children}</div>
    </div>
  );
}

const Num = ({
  v,
  set,
  suffix,
  max,
}: {
  v: number;
  set: (n: number) => void;
  suffix?: string;
  max?: number;
}) => (
  <div className="numin">
    <input
      type="number"
      min={0}
      max={max}
      value={v}
      onChange={(e) => set(Math.max(0, Math.min(max ?? 1e9, Math.floor(Number(e.target.value) || 0))))}
    />
    {suffix && <span>{suffix}</span>}
  </div>
);

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromTime = (v: string, fallback: number) => {
  const [h, m] = v.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : fallback;
};
const NEW_RULE: ScheduleRule = { days: 0b0011111, startMin: 9 * 60, endMin: 18 * 60, dlLimitKib: 512, ulLimitKib: 128 };

export function SettingsPage({
  snap,
  refresh,
  flash,
  dark,
  setDark,
  onAddTrackers,
  onAddCategory,
  onAddTag,
  onDeleteCategory,
  onDeleteTag,
  showRecent,
  setShowRecent,
  update,
  checkUpdate,
  installUpdate,
  hidden,
  toggleHidden,
  showAll,
  customize,
}: {
  snap: Snapshot;
  refresh: () => void;
  flash: (m: string) => void;
  dark: boolean;
  setDark: (v: boolean) => void;
  onAddTrackers: () => void;
  onAddCategory: () => void;
  onAddTag: () => void;
  onDeleteCategory: (n: string) => void;
  onDeleteTag: (n: string) => void;
  showRecent: boolean;
  setShowRecent: (v: boolean) => void;
  update: UpdateState;
  checkUpdate: () => void;
  installUpdate: () => void;
  hidden: Set<string>;
  toggleHidden: (id: string) => void;
  showAll: () => void;
  customize: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [draft, setDraft] = useState<S>(snap.settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(snap.settings);
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .defaultHandlerStatus()
      .then(setIsDefault)
      .catch(() => setIsDefault(null));
  }, [snap.settings.handleMagnets]);
  const up = (p: Partial<S>) => setDraft((d) => ({ ...d, ...p }));
  const rules = draft.schedule ?? [];
  const setRule = (i: number, p: Partial<ScheduleRule>) => up({ schedule: rules.map((r, j) => (j === i ? { ...r, ...p } : r)) });

  const save = async () => {
    try {
      const restart = await api.saveSettings(draft);
      flash(restart ? "Saved — restart Bunny Torrent to apply the highlighted options" : "Settings saved");
      refresh();
    } catch (e) {
      flash(errText(e));
    }
  };
  const pick = async () => {
    const r = await open({ directory: true, defaultPath: draft.downloadDir });
    if (typeof r === "string") up({ downloadDir: r });
  };

  return (
    <div className="settings">
      <nav className="stabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? "on" : ""} onClick={() => setTab(x.key)}>
            {x.label}
          </button>
        ))}
      </nav>

      <div className="spane">
        {snap.restartRequired && (
          <div className="banner">Some saved changes take effect after you restart Bunny Torrent.</div>
        )}

        {tab === "general" && (
          <>
            <Row title="Default save folder" desc="Where new torrents are downloaded unless a category or the Add dialog says otherwise." restart>
              <div className="inrow wide">
                <input value={draft.downloadDir} onChange={(e) => up({ downloadDir: e.target.value })} />
                <button className="ghost" onClick={pick}>
                  Browse…
                </button>
              </div>
            </Row>
            <Row
              title="Open magnet links with Bunny Torrent"
              desc={
                "Clicking a magnet link on a website opens a window to pick files and priorities. " +
                (isDefault === null ? "" : isDefault ? "Currently registered for this Windows account." : "Not registered right now. Save to apply.")
              }
            >
              <Toggle on={draft.handleMagnets} onChange={(v) => up({ handleMagnets: v })} label="Handle magnet links" />
            </Row>
            <Row
              title="Sort downloads into folders by type"
              desc="New downloads go into Videos, Music, Documents and so on inside your default save folder. A category's own folder, or a folder you pick when adding, still wins."
            >
              <Toggle on={draft.sortByType} onChange={(v) => up({ sortByType: v })} label="Sort by type" />
            </Row>
            {draft.sortByType && (
              <div className="listbox">
                <div className="listhead2">
                  <b>Folder for each type</b>
                </div>
                <div className="foldergrid">
                  {KINDS.map((k) => (
                    <label key={k.key} className="fld">
                      <span>{k.label}</span>
                      <input
                        value={draft.typeFolders[k.key] ?? ""}
                        placeholder={DEFAULT_FOLDER[k.key]}
                        onChange={(e) => {
                          const next = { ...draft.typeFolders };
                          if (e.target.value) next[k.key] = e.target.value;
                          else delete next[k.key];
                          up({ typeFolders: next });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Row title="Show recent torrents on Overview" desc="Turn this off for a cleaner Overview with just the cards and search.">
              <Toggle on={showRecent} onChange={setShowRecent} label="Show recent torrents" />
            </Row>
            <Row title="Start new torrents paused" desc="They’ll wait in the list until you press resume.">
              <Toggle on={draft.startPaused} onChange={(v) => up({ startPaused: v })} label="Start paused" />
            </Row>
            <Row title="Keep running in the tray when I close the window" desc="Downloads and seeding continue. Use the tray icon’s Quit to exit.">
              <Toggle on={draft.closeToTray ?? true} onChange={(v) => up({ closeToTray: v })} label="Keep running in the tray" />
            </Row>
            <Row title="Start with Windows" desc="Starts hidden in the tray.">
              <Toggle on={draft.startWithWindows ?? false} onChange={(v) => up({ startWithWindows: v })} label="Start with Windows" />
            </Row>
            <Row title="Notify me when a download finishes" desc="A Windows notification, works even while the window is hidden.">
              <Toggle on={draft.notifyOnComplete ?? false} onChange={(v) => up({ notifyOnComplete: v })} label="Notify when a download finishes" />
            </Row>
            <Row title="Dark theme">
              <Toggle on={dark} onChange={setDark} label="Dark theme" />
            </Row>
          </>
        )}

        {tab === "sidebar" && (
          <>
            <Row title="Choose what appears in the sidebar" desc="Turn whole sections or single items on and off. You can also do this right from the sidebar.">
              <div className="inrow">
                <button className="ghost" onClick={customize}>
                  Customize in sidebar
                </button>
                <button className="ghost" onClick={showAll}>
                  Show everything
                </button>
              </div>
            </Row>
            {GROUPS.map((g) => (
              <div className="listbox" key={g.id}>
                <div className="listhead2">
                  <div>
                    <b>{g.label}</b>
                    <small className="blurb">{g.blurb}</small>
                  </div>
                  <Toggle on={!hidden.has(`group:${g.id}`)} onChange={() => toggleHidden(`group:${g.id}`)} label={`Show ${g.label}`} />
                </div>
                {!hidden.has(`group:${g.id}`) && (
                  <div className="chips">
                    {STATIC_ITEMS.filter((i) => i.group === g.id).map((i) => (
                      <button key={i.id} className={`chip ${hidden.has(i.id) ? "" : "on"}`} onClick={() => toggleHidden(i.id)} aria-pressed={!hidden.has(i.id)} title={hidden.has(i.id) ? "Hidden — click to show" : "Shown — click to hide"}>
                        {hidden.has(i.id) ? "" : "✓ "}
                        {i.label}
                      </button>
                    ))}
                    {["categories", "tags", "trackers"].includes(g.id) && (
                      <em className="faint">Your own entries can be hidden from the sidebar’s customize mode.</em>
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {tab === "search" && (
          <>
            {SEARCH_SOURCES.map((src) => (
              <Row key={src.id} title={src.label} desc={src.blurb}>
                <Toggle
                  on={draft.searchSources.includes(src.id)}
                  onChange={(v) =>
                    up({ searchSources: v ? [...draft.searchSources, src.id] : draft.searchSources.filter((x) => x !== src.id) })
                  }
                  label={src.label}
                />
              </Row>
            ))}
            <Row
              title="Search history"
              desc={`${snap.searchHistory.length} saved search${snap.searchHistory.length === 1 ? "" : "es"}. They appear when you click the search box on Overview.`}
            >
              <button
                className="ghost"
                disabled={snap.searchHistory.length === 0}
                onClick={async () => {
                  await api.clearSearchHistory();
                  refresh();
                }}
              >
                Clear history
              </button>
            </Row>
            <p className="note">
              Results come from public sources over the internet. Make sure you have the right to download what you add.
            </p>
          </>
        )}

        {tab === "speed" && (
          <>
            <Row title="Download limit" desc="Maximum total download speed. 0 means unlimited. Applies instantly.">
              <Num v={draft.dlLimitKib} set={(n) => up({ dlLimitKib: n })} suffix="KiB/s" max={4_000_000} />
            </Row>
            <Row title="Upload limit" desc="Maximum total upload speed. 0 means unlimited. Very low upload limits slow your downloads too, since peers reward sharing.">
              <Num v={draft.ulLimitKib} set={(n) => up({ ulLimitKib: n })} suffix="KiB/s" max={4_000_000} />
            </Row>
            <Row title="Use a speed schedule" desc="Apply different limits at set times, for example a slower connection during work hours.">
              <Toggle on={!!draft.scheduleEnabled} onChange={(v) => up({ scheduleEnabled: v })} label="Use a speed schedule" />
            </Row>
            {draft.scheduleEnabled && (
              <div className="listbox">
                <div className="listhead2">
                  <b>Schedule rules</b>
                  <button className="ghost" onClick={() => up({ schedule: [...rules, { ...NEW_RULE }] })}>
                    <Icon d={P.plus} size={13} /> Add rule
                  </button>
                </div>
                {rules.length === 0 && <em className="faint">No rules yet. Add one to set limits for certain days and hours.</em>}
                <div className="sched">
                  {rules.map((r, i) => (
                    <div className="rule" key={i}>
                      <div className="chips">
                        {DAYS.map((d, b) => (
                          <button key={d} className={`chip ${r.days & (1 << b) ? "on" : ""}`} aria-pressed={!!(r.days & (1 << b))} onClick={() => setRule(i, { days: r.days ^ (1 << b) })}>
                            {d}
                          </button>
                        ))}
                      </div>
                      <input type="time" value={toTime(r.startMin)} onChange={(e) => setRule(i, { startMin: fromTime(e.target.value, r.startMin) })} aria-label="Start time" />
                      <span className="dash">to</span>
                      <input type="time" value={toTime(r.endMin)} onChange={(e) => setRule(i, { endMin: fromTime(e.target.value, r.endMin) })} aria-label="End time" />
                      <span className="dash">↓</span>
                      <Num v={r.dlLimitKib} set={(n) => setRule(i, { dlLimitKib: n })} suffix="KiB/s" max={4_000_000} />
                      <span className="dash">↑</span>
                      <Num v={r.ulLimitKib} set={(n) => setRule(i, { ulLimitKib: n })} suffix="KiB/s" max={4_000_000} />
                      <button className="x" onClick={() => up({ schedule: rules.filter((_, j) => j !== i) })} aria-label="Delete rule">
                        <Icon d={P.trash} size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <small className="blurb">0 = unlimited in that window. A window that ends before it starts runs past midnight. Outside these windows the normal limits above apply.</small>
              </div>
            )}
          </>
        )}

        {tab === "queue" && (
          <>
            <Row title="Maximum active downloads" desc="How many unfinished torrents download at once. The rest wait as Queued and start automatically as others finish. 0 means no limit.">
              <Num v={draft.maxActiveDownloads ?? 0} set={(n) => up({ maxActiveDownloads: n })} max={1000} />
            </Row>
            <Row title="Stop seeding at share ratio" desc="Once you have uploaded this many times the size of the download, the seeding limit action is applied. 0 means off.">
              <div className="numin">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={draft.seedRatioLimit ?? 0}
                  onChange={(e) => up({ seedRatioLimit: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            </Row>
            <Row title="Stop seeding after" desc="Time spent seeding a finished torrent before the limit action is applied. Decimals are fine, for example 1.5 hours. 0 means off.">
              <div className="numin">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={+((draft.seedTimeLimitMins ?? 0) / 60).toFixed(2)}
                  onChange={(e) => up({ seedTimeLimitMins: Math.max(0, Math.round((Number(e.target.value) || 0) * 60)) })}
                />
                <span>hours</span>
              </div>
            </Row>
            <Row title="When a seeding limit is reached" desc="Removing only takes the torrent off the list; the downloaded files stay on disk.">
              <select value={draft.seedLimitAction ?? "pause"} onChange={(e) => up({ seedLimitAction: e.target.value as S["seedLimitAction"] })}>
                <option value="pause">Pause the torrent</option>
                <option value="remove">Remove it from the list (keeps the files)</option>
              </select>
            </Row>
          </>
        )}

        {tab === "automation" && <AutomationTab snap={snap} draft={draft} up={up} flash={flash} refresh={refresh} />}

        {tab === "connection" && (
          <>
            <Row title="Listening port" desc="Incoming connections arrive here. Forward it on your router for best speeds (UPnP can do that automatically). If it’s taken, a random port is used." restart>
              <Num v={draft.listenPort} set={(n) => up({ listenPort: n })} max={65535} />
            </Row>
            <Row title="UPnP port forwarding" desc="Ask your router to open the listening port." restart>
              <Toggle on={draft.upnp} onChange={(v) => up({ upnp: v })} label="UPnP" />
            </Row>
            <Row title="DHT (trackerless peer discovery)" desc="Finds more peers, and lets magnet links work without trackers." restart>
              <Toggle on={draft.dht} onChange={(v) => up({ dht: v })} label="DHT" />
            </Row>
            <Row title="Max connections per torrent" desc="0 uses the engine default. Lower it on weak routers." restart>
              <Num v={draft.peerLimit} set={(n) => up({ peerLimit: n })} max={10000} />
            </Row>
            <Row title="IP blocklist address" desc="A link to a plain-text or gzipped list of IP ranges to refuse connections from. Leave empty to turn it off." restart>
              <div className="inrow wide">
                <input value={draft.blocklistUrl ?? ""} placeholder="https://example.com/blocklist.txt.gz" onChange={(e) => up({ blocklistUrl: e.target.value.trim() })} />
              </div>
            </Row>
          </>
        )}

        {tab === "trackers" && (
          <>
            <Row title="Add my tracker list to new torrents" desc="More trackers usually means more peers.">
              <Toggle on={draft.autoTrackers} onChange={(v) => up({ autoTrackers: v })} label="Auto-add trackers" />
            </Row>
            <div className="listbox">
              <div className="listhead2">
                <b>Saved trackers ({snap.trackerList.length})</b>
                <button className="ghost" onClick={onAddTrackers}>
                  <Icon d={P.plus} size={13} /> Add
                </button>
              </div>
              {snap.trackerList.length === 0 && <em className="faint">No saved trackers yet.</em>}
              {snap.trackerList.map((u) => (
                <div className="li" key={u}>
                  <span title={u}>
                    {u} <small>({hostOf(u)})</small>
                  </span>
                  <button className="x" onClick={() => api.removeTrackerList(u).then(refresh)} aria-label="Remove tracker">
                    <Icon d={P.close} size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "organise" && (
          <div className="two">
            <div className="listbox">
              <div className="listhead2">
                <b>Categories</b>
                <button className="ghost" onClick={onAddCategory}>
                  <Icon d={P.plus} size={13} /> New
                </button>
              </div>
              {snap.categories.length === 0 && <em className="faint">None yet. Torrents show as “Uncategorised”.</em>}
              {snap.categories.map((c) => (
                <div className="li" key={c.name}>
                  <span>
                    {c.name} <small>{c.savePath ?? "default folder"}</small>
                  </span>
                  <button className="x" onClick={() => onDeleteCategory(c.name)} aria-label={`Delete ${c.name}`}>
                    <Icon d={P.trash} size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="listbox">
              <div className="listhead2">
                <b>Tags</b>
                <button className="ghost" onClick={onAddTag}>
                  <Icon d={P.plus} size={13} /> New
                </button>
              </div>
              {snap.tags.length === 0 && <em className="faint">None yet. Torrents show as “Untagged”.</em>}
              {snap.tags.map((g) => (
                <div className="li" key={g}>
                  <span>{g}</span>
                  <button className="x" onClick={() => onDeleteTag(g)} aria-label={`Delete ${g}`}>
                    <Icon d={P.trash} size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "about" && (
          <About
            update={update}
            onCheck={checkUpdate}
            onInstall={installUpdate}
            autoUpdate={snap.settings.autoUpdate}
            setAutoUpdate={async (v) => {
              try {
                await api.saveSettings({ ...snap.settings, autoUpdate: v });
                refresh();
              } catch (e) {
                flash(errText(e));
              }
            }}
          />
        )}
      </div>

      {dirty && (
        <div className="savebar">
          <span>You have unsaved changes</span>
          <button onClick={() => setDraft(snap.settings)}>Discard</button>
          <button className="primary" onClick={save}>
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}
