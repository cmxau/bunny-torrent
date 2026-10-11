//! Adding torrents: resolving sources, choosing a destination folder, preview and confirm.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use librqbit::{
    api::TorrentIdOrHash, AddTorrent, AddTorrentOptions, AddTorrentResponse,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    priorities::desired_set,
    store::{now, App, Meta, Settings},
    torrents::kind_from_paths,
};

// ---------------------------------------------------------------- where downloads go

pub const KIND_DEFAULT_FOLDERS: [(&str, &str); 7] = [
    ("videos", "Videos"),
    ("music", "Music"),
    ("documents", "Documents"),
    ("images", "Pictures"),
    ("archives", "Archives"),
    ("apps", "Apps"),
    ("other", "Other"),
];

pub fn sanitize(name: &str) -> String {
    let n: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let n = n.trim().trim_matches('.').to_string();
    if n.is_empty() {
        "torrent".into()
    } else {
        n
    }
}

pub fn type_folder_name(settings: &Settings, kind: &str) -> String {
    let custom = settings.type_folders.get(kind).map(|n| sanitize(n));
    custom.filter(|n| n != "torrent").unwrap_or_else(|| {
        KIND_DEFAULT_FOLDERS
            .iter()
            .find(|(k, _)| *k == kind)
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| "Other".into())
    })
}

/// Final folder for a torrent: your explicit choice, else the category's folder, else the folder for its
/// content type. Multi-file torrents get their own subfolder, like the engine does by default.
pub fn target_folder(
    settings: &Settings,
    kind: &str,
    name: &str,
    multi: bool,
    explicit: Option<&str>,
    category_path: Option<&str>,
) -> Option<String> {
    let base: PathBuf = explicit
        .filter(|p| !p.trim().is_empty())
        .or(category_path.filter(|p| !p.trim().is_empty()))
        .map(PathBuf::from)
        .or_else(|| {
            settings
                .sort_by_type
                .then(|| Path::new(&settings.download_dir).join(type_folder_name(settings, kind)))
        })?;
    Some(if multi { base.join(sanitize(name)) } else { base }.display().to_string())
}

pub struct Resolved {
    torrent: Vec<u8>,
    name: String,
    paths: Vec<String>,
    lens: Vec<u64>,
    kind: &'static str,
    trackers: Vec<String>,
    hash: String,
}

pub enum Resolve {
    Existing(usize),
    New(Resolved),
}

/// Reads a torrent's file list without downloading anything (waits for peers if it's a magnet link).
pub async fn resolve(
    app: &App,
    source: AddTorrent<'static>,
    hint: Option<TorrentIdOrHash>,
    trackers: Vec<String>,
    secs: u64,
) -> Result<Resolve, String> {
    if let Some(t) = hint.and_then(|h| app.session.get(h)) {
        return Ok(Resolve::Existing(t.id()));
    }
    let r = tokio::time::timeout(
        std::time::Duration::from_secs(secs),
        app.session.add_torrent(
            source,
            Some(AddTorrentOptions {
                list_only: true,
                ..Default::default()
            }),
        ),
    )
    .await
    .map_err(|_| "Couldn't get the file list in time. The link may have no active peers right now.".to_string())?
    .map_err(|e| e.to_string())?;
    let lo = match r {
        AddTorrentResponse::ListOnly(lo) => lo,
        AddTorrentResponse::AlreadyManaged(id, _) => return Ok(Resolve::Existing(id)),
        AddTorrentResponse::Added(..) => return Err("unexpected engine response".into()),
    };
    let (mut paths, mut lens) = (vec![], vec![]);
    for f in lo.info.iter_file_details() {
        paths.push(f.filename.to_vec().join("/"));
        lens.push(f.len);
    }
    Ok(Resolve::New(Resolved {
        kind: kind_from_paths(&paths, &lens),
        name: lo.info.name().map(|n| n.to_string()).unwrap_or_default(),
        torrent: lo.torrent_bytes.to_vec(),
        paths,
        lens,
        trackers,
        hash: lo.info_hash.as_string(),
    }))
}

/// Turns a magnet link or .torrent path into an add source plus what we know up front.
pub fn source_of(magnet: Option<String>, path: Option<String>) -> Result<(AddTorrent<'static>, Option<TorrentIdOrHash>, Vec<String>), String> {
    if let Some(m) = magnet.map(|m| m.trim().to_string()).filter(|m| !m.is_empty()) {
        if m.starts_with("http://") || m.starts_with("https://") {
            return Ok((AddTorrent::from_url(m), None, vec![]));
        }
        let parsed = librqbit::Magnet::parse(&m).map_err(|e| format!("Not a valid magnet link: {e}"))?;
        return Ok((
            AddTorrent::from_url(m),
            parsed.as_id20().map(TorrentIdOrHash::Hash),
            parsed.trackers.clone(),
        ));
    }
    let p = path.ok_or_else(|| "nothing to add".to_string())?;
    let bytes = std::fs::read(&p).map_err(|e| format!("{p}: {e}"))?;
    let h = librqbit::torrent_from_bytes(&bytes)
        .map_err(|e| format!("Not a valid .torrent file: {e}"))?
        .info_hash;
    Ok((AddTorrent::from_bytes(bytes), Some(TorrentIdOrHash::Hash(h)), vec![]))
}

// ---------------------------------------------------------------- add / control

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddReq {
    pub magnet: Option<String>,
    #[serde(default)]
    pub paths: Vec<String>,
    pub save_path: Option<String>,
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub paused: Option<bool>,
    #[serde(default)]
    pub trackers: Vec<String>,
}

#[derive(Serialize)]
pub struct AddResult {
    pub added: u32,
    pub duplicates: u32,
    /// magnet links whose contents couldn't be read in time; they went to the main folder
    unsorted: u32,
}

/// What an add needs from the store: settings, the chosen category's folder, and the extra trackers
/// (the request's own plus the global list when auto-trackers is on).
struct AddContext {
    settings: Settings,
    cat_path: Option<String>,
    extra_trackers: Vec<String>,
}

impl AddContext {
    fn load(app: &App, category: Option<&str>, req_trackers: &[String]) -> Self {
        let s = app.store.lock().unwrap();
        let cat_path = category
            .and_then(|c| s.categories.iter().find(|x| x.name == c))
            .and_then(|c| c.save_path.clone());
        let mut extra_trackers: Vec<String> = req_trackers.iter().map(|t| t.trim().to_string()).collect();
        if s.settings.auto_trackers {
            extra_trackers.extend(s.tracker_list.iter().cloned());
        }
        Self { settings: s.settings.clone(), cat_path, extra_trackers }
    }

    /// The torrent's own trackers plus the extras, deduplicated; None when there are none.
    fn trackers_for(&self, own: &[String]) -> Option<Vec<String>> {
        let mut all: Vec<String> = own.iter().chain(&self.extra_trackers).cloned().collect();
        all.retain(|t| !t.is_empty());
        all.sort();
        all.dedup();
        (!all.is_empty()).then_some(all)
    }
}

#[tauri::command]
pub async fn add(app: State<'_, App>, req: AddReq) -> Result<AddResult, String> {
    add_core(&app, req).await
}

/// The body of the `add` command, also used by watch folders and feeds.
pub async fn add_core(app: &App, req: AddReq) -> Result<AddResult, String> {
    let ctx = AddContext::load(app, req.category.as_deref(), &req.trackers);
    let AddContext { settings, cat_path, .. } = &ctx;
    let mut inputs: Vec<(Option<String>, Option<String>)> = vec![];
    if let Some(m) = req.magnet.as_ref() {
        for line in m.lines().map(str::trim).filter(|l| !l.is_empty()) {
            inputs.push((Some(line.to_string()), None));
        }
    }
    for p in &req.paths {
        inputs.push((None, Some(p.clone())));
    }
    if inputs.is_empty() {
        return Err("nothing to add".into());
    }

    let paused = req.paused.unwrap_or(settings.start_paused);
    let (mut added, mut duplicates, mut unsorted) = (0, 0, 0);
    for (magnet, path) in inputs {
        let is_magnet = magnet.is_some();
        let (source, hint, magnet_trackers) = source_of(magnet.clone(), path)?;
        let secs = if is_magnet { 45 } else { 15 };
        let tr = ctx.trackers_for(&magnet_trackers);

        let resp = match resolve(app, source, hint, magnet_trackers, secs).await {
            Ok(Resolve::Existing(_)) => {
                duplicates += 1;
                continue;
            }
            Ok(Resolve::New(r)) => {
                let out = target_folder(
                    settings,
                    r.kind,
                    &r.name,
                    r.paths.len() >= 2,
                    req.save_path.as_deref(),
                    cat_path.as_deref(),
                );
                app.session
                    .add_torrent(
                        AddTorrent::from_bytes(r.torrent),
                        Some(AddTorrentOptions {
                            overwrite: true,
                            paused,
                            output_folder: out,
                            trackers: tr,
                            ..Default::default()
                        }),
                    )
                    .await
                    .map_err(|e| e.to_string())?
            }
            Err(e) if is_magnet => {
                // No peers answered yet: add it anyway, to the main folder, and let it keep trying.
                let _ = e;
                unsorted += 1;
                app.session
                    .add_torrent(
                        AddTorrent::from_url(magnet.unwrap_or_default()),
                        Some(AddTorrentOptions {
                            overwrite: true,
                            paused,
                            output_folder: req.save_path.clone().filter(|p| !p.trim().is_empty()).or(cat_path.clone()),
                            trackers: tr,
                            ..Default::default()
                        }),
                    )
                    .await
                    .map_err(|e| e.to_string())?
            }
            Err(e) => return Err(e),
        };
        match resp {
            AddTorrentResponse::Added(_, h) => {
                added += 1;
                let hash = h.info_hash().as_string();
                app.with_store(|s| {
                    let queue_pos = crate::queue::next_pos(s);
                    s.torrents.insert(
                        hash,
                        Meta {
                            queue_pos,
                            user_stopped: paused,
                            category: req.category.clone(),
                            tags: req.tags.clone(),
                            added_on: now(),
                            ..Default::default()
                        },
                    );
                });
            }
            AddTorrentResponse::AlreadyManaged(..) => duplicates += 1,
            AddTorrentResponse::ListOnly(_) => {}
        }
    }
    Ok(AddResult { added, duplicates, unsorted })
}

pub struct PreviewData {
    torrent: Vec<u8>,
    lens: Vec<u64>,
    trackers: Vec<String>,
    name: String,
    kind: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    index: usize,
    path: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    token: String,
    name: String,
    hash: String,
    total_bytes: u64,
    files: Vec<PreviewFile>,
    kind: String,
    /// where it will be saved unless the person changes it (empty when sorting is off)
    suggested_path: String,
    /// already in the list: select this torrent instead of adding it again
    existing_id: Option<usize>,
}

#[tauri::command]
pub async fn preview(
    app: State<'_, App>,
    magnet: Option<String>,
    path: Option<String>,
) -> Result<Preview, String> {
    let (source, hint, trackers) = source_of(magnet, path)?;
    let r = match resolve(&app, source, hint, trackers, 75).await? {
        Resolve::Existing(id) => {
            return Ok(Preview {
                token: String::new(),
                name: String::new(),
                hash: String::new(),
                total_bytes: 0,
                files: vec![],
                kind: String::new(),
                suggested_path: String::new(),
                existing_id: Some(id),
            })
        }
        Resolve::New(r) => r,
    };
    let settings = app.store.lock().unwrap().settings.clone();
    let suggested = target_folder(&settings, r.kind, &r.name, r.paths.len() >= 2, None, None).unwrap_or_default();
    let token = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let files: Vec<PreviewFile> = r
        .paths
        .iter()
        .zip(&r.lens)
        .enumerate()
        .map(|(i, (p, l))| PreviewFile {
            index: i,
            path: p.clone(),
            size: *l,
        })
        .collect();
    {
        let mut g = app.previews.lock().unwrap();
        if g.len() >= 8 {
            g.clear(); // abandoned previews; they are cheap to fetch again
        }
        g.insert(
            token.clone(),
            PreviewData {
                torrent: r.torrent,
                lens: r.lens.clone(),
                trackers: r.trackers,
                name: r.name.clone(),
                kind: r.kind,
            },
        );
    }
    Ok(Preview {
        token,
        name: r.name,
        hash: r.hash,
        total_bytes: r.lens.iter().sum(),
        files,
        kind: r.kind.to_string(),
        suggested_path: suggested,
        existing_id: None,
    })
}

#[tauri::command]
pub fn drop_preview(app: State<'_, App>, token: String) {
    app.previews.lock().unwrap().remove(&token);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmReq {
    token: String,
    /// file index -> 0 skip, 2 high, 3 maximum (normal = absent)
    #[serde(default)]
    prios: HashMap<usize, u8>,
    save_path: Option<String>,
    category: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    paused: Option<bool>,
    #[serde(default)]
    trackers: Vec<String>,
}

#[tauri::command]
pub async fn add_previewed(app: State<'_, App>, req: ConfirmReq) -> Result<(), String> {
    let data = app
        .previews
        .lock()
        .unwrap()
        .remove(&req.token)
        .ok_or_else(|| "This preview expired — open the link again.".to_string())?;
    if req.prios.values().any(|p| *p > 3) {
        return Err("invalid priority".into());
    }
    let prios: HashMap<usize, u8> = req
        .prios
        .iter()
        .filter(|(i, p)| **p != 1 && **i < data.lens.len())
        .map(|(i, p)| (*i, *p))
        .collect();
    let files: Vec<(u64, u64, u8)> = data
        .lens
        .iter()
        .enumerate()
        .map(|(i, l)| (*l, 0, *prios.get(&i).unwrap_or(&1)))
        .collect();
    if files.iter().all(|f| f.2 == 0) {
        return Err("Pick at least one file to download.".into());
    }
    let only_files = if prios.is_empty() {
        None
    } else {
        let mut v: Vec<usize> = desired_set(&files).into_iter().collect();
        v.sort_unstable();
        Some(v)
    };

    let ctx = AddContext::load(&app, req.category.as_deref(), &req.trackers);
    let settings = &ctx.settings;
    let out = target_folder(
        settings,
        data.kind,
        &data.name,
        data.lens.len() >= 2,
        req.save_path.as_deref(),
        ctx.cat_path.as_deref(),
    );

    let r = app
        .session
        .add_torrent(
            AddTorrent::from_bytes(data.torrent),
            Some(AddTorrentOptions {
                overwrite: true,
                paused: req.paused.unwrap_or(settings.start_paused),
                output_folder: out,
                only_files,
                trackers: ctx.trackers_for(&data.trackers),
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
    match r {
        AddTorrentResponse::Added(_, h) => {
            let hash = h.info_hash().as_string();
            app.with_store(|s| {
                let queue_pos = crate::queue::next_pos(s);
                s.torrents.insert(
                    hash,
                    Meta {
                        queue_pos,
                        user_stopped: req.paused.unwrap_or(settings.start_paused),
                        category: req.category.clone(),
                        tags: req.tags.clone(),
                        added_on: now(),
                        file_prio: prios,
                        ..Default::default()
                    },
                );
            });
            Ok(())
        }
        AddTorrentResponse::AlreadyManaged(..) => Err("That torrent is already in your list.".into()),
        AddTorrentResponse::ListOnly(_) => Err("unexpected engine response".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use librqbit::{Session, SessionOptions, TorrentStatsState};

    use crate::{priorities::apply_priorities, store::Store};

    fn cfg() -> Settings {
        Settings {
            download_dir: "D:/dl".into(),
            ..Default::default()
        }
    }

    #[test]
    fn single_file_goes_into_its_type_folder() {
        let p = target_folder(&cfg(), "videos", "movie.mkv", false, None, None).unwrap();
        assert_eq!(p.replace('\\', "/"), "D:/dl/Videos");
    }

    #[test]
    fn multi_file_gets_its_own_subfolder() {
        let p = target_folder(&cfg(), "music", "Great Album", true, None, None).unwrap();
        assert_eq!(p.replace('\\', "/"), "D:/dl/Music/Great Album");
    }

    #[test]
    fn explicit_and_category_paths_win_over_type_folders() {
        let p = target_folder(&cfg(), "videos", "x", false, Some("E:/mine"), Some("F:/cat")).unwrap();
        assert_eq!(p.replace('\\', "/"), "E:/mine");
        let p = target_folder(&cfg(), "videos", "x", false, None, Some("F:/cat")).unwrap();
        assert_eq!(p.replace('\\', "/"), "F:/cat");
    }

    #[test]
    fn sorting_can_be_turned_off() {
        let mut c = cfg();
        c.sort_by_type = false;
        assert_eq!(target_folder(&c, "videos", "x", true, None, None), None);
    }

    #[test]
    fn custom_folder_names_and_unsafe_names_are_handled() {
        let mut c = cfg();
        c.type_folders.insert("images".into(), "My Photos".into());
        assert_eq!(type_folder_name(&c, "images"), "My Photos");
        assert_eq!(type_folder_name(&c, "images2"), "Other");
        assert_eq!(sanitize("../evil:name?"), "_evil_name_");
    }

    /// A tiny valid multi-file .torrent (content hashes are irrelevant for listing).
    fn tiny_torrent() -> Vec<u8> {
        let mut t: Vec<u8> = b"d4:infod5:filesld6:lengthi100e4:pathl8:song.mp3eed6:lengthi50e4:pathl9:cover.jpgeed6:lengthi30e4:pathl8:info.txteee4:name10:Test Album12:piece lengthi16384e6:pieces20:".to_vec();
        t.extend_from_slice(&[7u8; 20]);
        t.extend_from_slice(b"ee");
        t
    }

    #[tokio::test]
    async fn real_engine_lists_files_sorts_into_type_folder_and_stages_priorities() {
        let root = std::env::temp_dir().join(format!(
            "bunny-test-{}",
            std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let dl = root.join("dl");
        let session = Session::new_with_opts(
            dl.clone(),
            SessionOptions {
                dht: None,
                persistence: None,
                listen: None,
                disable_trackers: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let mut store = Store::default();
        store.settings.download_dir = dl.display().to_string();
        let app = App {
            session: session.clone(),
            store: Arc::new(Mutex::new(store)),
            store_path: root.join("store.json"),
            startup: Settings::default(),
            kinds: Mutex::new(HashMap::new()),
            previews: Mutex::new(HashMap::new()),
            incoming: Mutex::new(vec![]),
        };

        // 1. reading the file list
        let torrent_path = root.join("t.torrent");
        std::fs::write(&torrent_path, tiny_torrent()).unwrap();
        let (src, hint, tr) = source_of(None, Some(torrent_path.display().to_string())).unwrap();
        let r = match resolve(&app, src, hint, tr, 10).await.unwrap() {
            Resolve::New(r) => r,
            Resolve::Existing(_) => panic!("should be new"),
        };
        assert_eq!(r.name, "Test Album");
        assert_eq!(r.paths, vec!["song.mp3", "cover.jpg", "info.txt"]);
        assert_eq!(r.lens, vec![100, 50, 30]);
        assert_eq!(r.kind, "music");

        // 2. destination: dl/Music/Test Album (multi-file gets its own folder)
        let settings = app.store.lock().unwrap().settings.clone();
        let out = target_folder(&settings, r.kind, &r.name, r.paths.len() >= 2, None, None).unwrap();
        assert!(out.replace('\\', "/").ends_with("/dl/Music/Test Album"), "{out}");

        // 3. add like the popup does: cover.jpg Maximum, info.txt skipped, song.mp3 normal
        let prios: HashMap<usize, u8> = [(1, 3), (2, 0)].into_iter().collect();
        let files: Vec<(u64, u64, u8)> = r.lens.iter().enumerate().map(|(i, l)| (*l, 0, *prios.get(&i).unwrap_or(&1))).collect();
        let mut only: Vec<usize> = desired_set(&files).into_iter().collect();
        only.sort_unstable();
        assert_eq!(only, vec![1]); // Maximum tier only, skipped file never selected
        let added = session
            .add_torrent(
                AddTorrent::from_bytes(r.torrent),
                Some(AddTorrentOptions {
                    overwrite: true,
                    paused: true,
                    output_folder: Some(out.clone()),
                    only_files: Some(only),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
        let h = match added {
            AddTorrentResponse::Added(_, h) => h,
            _ => panic!("expected Added"),
        };
        assert_eq!(h.output_folder().display().to_string(), out);

        // 4. wait until the engine finished its startup check, then confirm the tier switching
        for _ in 0..50 {
            if !matches!(h.stats().state, TorrentStatsState::Initializing { .. }) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert_eq!(h.only_files(), Some(vec![1]));
        // pretend the Maximum file finished: the next tier (normal song.mp3) must be selected, info.txt never
        let done_files: Vec<(u64, u64, u8)> = vec![(100, 0, 1), (50, 50, 3), (30, 0, 0)];
        assert_eq!(desired_set(&done_files), [0usize].into_iter().collect());
        apply_priorities(&session, &h, &[(1usize, 3u8), (2, 0)].into_iter().collect())
            .await
            .unwrap();
        assert_eq!(h.only_files().map(|mut v| { v.sort(); v }), Some(vec![1])); // nothing downloaded yet in the engine, so stays on tier one
        // resetting to all-normal re-selects every file
        apply_priorities(&session, &h, &HashMap::new()).await.unwrap();
        assert_eq!(h.only_files().map(|mut v| { v.sort(); v }), Some(vec![0, 1, 2]));

        let _ = std::fs::remove_dir_all(&root);
    }
}
