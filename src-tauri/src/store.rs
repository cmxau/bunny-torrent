//! The persisted library file, shared app state, and settings commands.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use librqbit::Session;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::{add::PreviewData, links::Incoming, schedule::ScheduleRule};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub download_dir: String,
    /// KiB/s, 0 = unlimited
    pub dl_limit_kib: u32,
    pub ul_limit_kib: u32,
    /// 0 = engine default
    pub peer_limit: u32,
    pub listen_port: u16,
    pub dht: bool,
    pub upnp: bool,
    pub auto_trackers: bool,
    pub start_paused: bool,
    /// register as the system handler for magnet: links
    pub handle_magnets: bool,
    /// put new downloads in a folder per content type (Videos, Music, ...)
    pub sort_by_type: bool,
    /// look for new versions on GitHub at startup and install them when nothing is downloading
    pub auto_update: bool,
    /// kind -> folder name; missing kinds use the built-in name
    pub type_folders: HashMap<String, String>,
    /// which online search sources are used: "internet-archive", "apibay"
    pub search_sources: Vec<String>,
    /// stop seeding at this upload/download ratio, 0 = off
    pub seed_ratio_limit: f32,
    /// stop seeding this many minutes after completion, 0 = off
    pub seed_time_limit_mins: u32,
    /// "pause" | "remove" (remove keeps the files)
    pub seed_limit_action: String,
    /// unfinished torrents that run at once, 0 = unlimited
    pub max_active_downloads: u32,
    pub schedule_enabled: bool,
    pub schedule: Vec<ScheduleRule>,
    /// IP blocklist loaded when the engine starts, "" = off
    pub blocklist_url: String,
    /// closing the window hides it to the tray instead of quitting
    pub close_to_tray: bool,
    /// launch (hidden in the tray) when Windows starts
    pub start_with_windows: bool,
    /// native notification when a download finishes
    pub notify_on_complete: bool,
    /// folders watched for dropped .torrent files
    pub watch_folders: Vec<WatchFolder>,
    /// RSS/Atom feeds checked in the background
    pub feeds: Vec<Feed>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WatchFolder {
    pub path: String,
    pub category: Option<String>,
    /// add what is found paused
    pub paused: bool,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FeedFilter {
    pub include: String,
    pub exclude: String,
    pub regex: bool,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Feed {
    pub id: String,
    pub name: String,
    pub url: String,
    /// minutes between checks (never less than 5)
    pub interval_mins: u32,
    pub enabled: bool,
    pub category: Option<String>,
    pub paused: bool,
    /// on the first check also add what is already in the feed
    pub add_existing: bool,
    pub filters: Vec<FeedFilter>,
}

impl Default for Feed {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            url: String::new(),
            interval_mins: 30,
            enabled: false,
            category: None,
            paused: false,
            add_existing: false,
            filters: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AddedItem {
    pub title: String,
    pub at: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FeedState {
    /// unix seconds, 0 = never
    pub last_checked: u64,
    pub last_error: Option<String>,
    /// ids of items already handled (newest 500)
    pub seen: Vec<String>,
    pub added_total: u32,
    /// newest 20 additions, newest first
    pub recent: Vec<AddedItem>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WatchState {
    pub last_scan: u64,
    pub last_error: Option<String>,
    pub added_total: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: dirs::download_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("BunnyTorrent")
                .display()
                .to_string(),
            dl_limit_kib: 0,
            ul_limit_kib: 0,
            peer_limit: 0,
            listen_port: 6881,
            dht: true,
            upnp: true,
            auto_trackers: true,
            start_paused: false,
            handle_magnets: true,
            sort_by_type: true,
            auto_update: true,
            type_folders: HashMap::new(),
            search_sources: vec!["internet-archive".into(), "apibay".into()],
            seed_ratio_limit: 0.0,
            seed_time_limit_mins: 0,
            seed_limit_action: "pause".into(),
            max_active_downloads: 0,
            schedule_enabled: false,
            schedule: Vec::new(),
            blocklist_url: String::new(),
            close_to_tray: true,
            start_with_windows: false,
            notify_on_complete: false,
            watch_folders: Vec::new(),
            feeds: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub name: String,
    pub save_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Meta {
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub added_on: u64,
    pub completed_on: u64,
    /// seconds this torrent has spent running (not stopped)
    pub active_secs: u64,
    /// file index -> 0 skip, 2 high, 3 maximum (1 = normal = absent)
    pub file_prio: HashMap<usize, u8>,
    /// position in the download queue (lower runs first)
    pub queue_pos: u32,
    /// paused by the user; the queue manager leaves it alone
    pub user_stopped: bool,
    /// runs regardless of the active-download limit
    pub force_start: bool,
    /// a seeding rule already fired for this torrent
    pub seed_limit_hit: bool,
    /// paused by the queue manager because the active-download limit is full
    pub queued: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Store {
    pub settings: Settings,
    pub categories: Vec<Category>,
    pub tags: Vec<String>,
    pub tracker_list: Vec<String>,
    pub torrents: HashMap<String, Meta>,
    /// recent online searches, newest first
    pub search_history: Vec<String>,
    /// feed id -> what the feed checker remembers
    pub feed_state: HashMap<String, FeedState>,
    /// watch folder path -> last scan info
    pub watch_state: HashMap<String, WatchState>,
}

pub struct App {
    pub session: Arc<Session>,
    pub store: Arc<Mutex<Store>>,
    pub store_path: PathBuf,
    pub startup: Settings,
    pub kinds: Mutex<HashMap<String, &'static str>>,
    pub previews: Mutex<HashMap<String, PreviewData>>,
    pub incoming: Mutex<Vec<Incoming>>,
}

pub fn save_store(path: &Path, s: &Store) {
    if let Ok(j) = serde_json::to_vec_pretty(s) {
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, j).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

impl App {
    pub fn save(&self, s: &Store) {
        save_store(&self.store_path, s);
    }
    pub fn with_store<R>(&self, f: impl FnOnce(&mut Store) -> R) -> R {
        let mut g = self.store.lock().unwrap();
        let r = f(&mut g);
        self.save(&g);
        r
    }
    /// Like `with_store`, but only writes the file when the closure says something worth saving changed.
    pub fn with_store_if(&self, f: impl FnOnce(&mut Store) -> bool) {
        let mut g = self.store.lock().unwrap();
        if f(&mut g) {
            self.save(&g);
        }
    }
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn restart_needed(a: &Settings, b: &Settings) -> bool {
    a.download_dir != b.download_dir
        || a.peer_limit != b.peer_limit
        || a.listen_port != b.listen_port
        || a.dht != b.dht
        || a.upnp != b.upnp
        || a.blocklist_url != b.blocklist_url
}

pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("BunnyTorrent")
}

#[tauri::command]
pub fn save_settings(handle: AppHandle, app: State<'_, App>, settings: Settings) -> bool {
    let was = app.store.lock().unwrap().settings.handle_magnets;
    if was != settings.handle_magnets {
        let dl = handle.deep_link();
        let _ = if settings.handle_magnets { dl.register("magnet") } else { dl.unregister("magnet") };
    }
    if app.store.lock().unwrap().settings.start_with_windows != settings.start_with_windows {
        crate::tray::sync_autostart(&handle, settings.start_with_windows);
    }
    crate::schedule::apply(&app.session, crate::schedule::current_limits(&settings));
    let need = restart_needed(&app.startup, &settings);
    app.with_store(|s| s.settings = settings);
    need
}

#[tauri::command]
pub fn open_folder(path: Option<String>, app: State<'_, App>) {
    let p = path.unwrap_or_else(|| app.store.lock().unwrap().settings.download_dir.clone());
    let _ = std::process::Command::new("explorer").arg(p).spawn();
}
