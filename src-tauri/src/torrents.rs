//! Torrent list, live snapshot, details, and pause/resume/remove.

use std::{collections::HashMap, path::Path, sync::Arc};

use librqbit::{api::TorrentIdOrHash, ManagedTorrent, TorrentStatsState};
use serde::Serialize;
use tauri::State;

use crate::store::{now, restart_needed, AddedItem, App, Category, Meta, Settings};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentInfo {
    id: usize,
    hash: String,
    name: String,
    /// checking | downloading | queued | seeding | stopped | errored
    pub state: &'static str,
    pub finished: bool,
    progress: f64,
    pub total_bytes: u64,
    downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    down_bps: f64,
    up_bps: f64,
    eta_secs: Option<u64>,
    known_peers: u32,
    peers: u32,
    error: Option<String>,
    kind: &'static str,
    category: Option<String>,
    tags: Vec<String>,
    added_on: u64,
    completed_on: u64,
    active_secs: u64,
    save_path: String,
    trackers: Vec<String>,
    queue_pos: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedStatus {
    last_checked: u64,
    last_error: Option<String>,
    added_total: u32,
    recent: Vec<AddedItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    last_scan: u64,
    last_error: Option<String>,
    added_total: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    torrents: Vec<TorrentInfo>,
    disk_free: u64,
    disk_total: u64,
    categories: Vec<Category>,
    tags: Vec<String>,
    tracker_list: Vec<String>,
    search_history: Vec<String>,
    settings: Settings,
    restart_required: bool,
    feed_status: HashMap<String, FeedStatus>,
    watch_status: HashMap<String, WatchStatus>,
}

pub fn kind_of_ext(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "mkv" | "mp4" | "avi" | "mov" | "wmv" | "webm" | "m4v" | "mpg" | "mpeg" | "ts" | "flv" | "m2ts" => "videos",
        "mp3" | "flac" | "wav" | "ogg" | "m4a" | "aac" | "opus" | "wma" | "ape" => "music",
        "pdf" | "doc" | "docx" | "txt" | "epub" | "mobi" | "azw3" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "cbz"
        | "cbr" | "djvu" => "documents",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "svg" | "psd" | "raw" => "images",
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "zst" => "archives",
        "exe" | "msi" | "apk" | "dmg" | "deb" | "rpm" | "appimage" | "iso" | "bin" | "pkg" => "apps",
        _ => return None,
    })
}

/// The kind of content that makes up most of a torrent's bytes (cached once metadata is known).
pub fn detect_kind(app: &App, t: &Arc<ManagedTorrent>) -> &'static str {
    let hash = t.info_hash().as_string();
    if let Some(k) = app.kinds.lock().unwrap().get(&hash) {
        return k;
    }
    let Ok(kind) = t.with_metadata(|m| {
        let paths: Vec<String> = m
            .file_infos
            .iter()
            .map(|f| f.relative_filename.to_string_lossy().replace('\\', "/"))
            .collect();
        let lens: Vec<u64> = m.file_infos.iter().map(|f| f.len).collect();
        kind_from_paths(&paths, &lens)
    }) else {
        return "other"; // metadata not here yet; not cached so we retry next tick
    };
    app.kinds.lock().unwrap().insert(hash, kind);
    kind
}

pub fn kind_from_paths(paths: &[String], lens: &[u64]) -> &'static str {
    let mut by: HashMap<&'static str, u64> = HashMap::new();
    for (p, l) in paths.iter().zip(lens) {
        let ext = p.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        if let Some(k) = kind_of_ext(&ext) {
            *by.entry(k).or_default() += (*l).max(1);
        }
    }
    by.into_iter().max_by_key(|(_, n)| *n).map(|(k, _)| k).unwrap_or("other")
}

pub fn prio_of(meta: &Meta, i: usize) -> u8 {
    *meta.file_prio.get(&i).unwrap_or(&1)
}

pub fn info_of(id: usize, t: &Arc<ManagedTorrent>, meta: &Meta, kind: &'static str) -> TorrentInfo {
    let s = t.stats();
    // With custom file priorities the engine only sees one tier at a time, so size and
    // progress are computed from the files the user actually wants.
    let (mut total, mut got, mut finished) = (s.total_bytes, s.progress_bytes, s.finished);
    if meta.file_prio.values().any(|p| *p != 1) {
        if let Ok((tot, dn)) = t.with_metadata(|m| {
            let (mut tot, mut dn) = (0u64, 0u64);
            for (i, f) in m.file_infos.iter().enumerate() {
                if prio_of(meta, i) == 0 {
                    continue;
                }
                tot += f.len;
                dn += s.file_progress.get(i).copied().unwrap_or(0).min(f.len);
            }
            (tot, dn)
        }) {
            total = tot;
            got = dn;
            finished = tot > 0 && dn >= tot;
        }
    }
    let state = match s.state {
        TorrentStatsState::Initializing { .. } => "checking",
        TorrentStatsState::Live => {
            if finished {
                "seeding"
            } else {
                "downloading"
            }
        }
        TorrentStatsState::Paused if meta.queued && !finished => "queued",
        TorrentStatsState::Paused => "stopped",
        TorrentStatsState::Error => "errored",
    };
    let (down, up, eta, known_peers, peers) = match &s.live {
        Some(l) => {
            let p = &l.snapshot.peer_stats;
            let down = l.download_speed.as_bytes() as f64;
            let left = total.saturating_sub(got);
            let eta = (down > 0.0 && !finished).then(|| (left as f64 / down) as u64);
            (
                down,
                l.upload_speed.as_bytes() as f64,
                eta,
                p.seen,
                p.live,
            )
        }
        None => (0.0, 0.0, None, 0, 0),
    };
    let mut trackers: Vec<String> = t.shared().trackers.iter().map(|u| u.to_string()).collect();
    trackers.sort();
    TorrentInfo {
        id,
        hash: t.info_hash().as_string(),
        name: t.name().unwrap_or_else(|| "Fetching metadata...".into()),
        state,
        finished,
        progress: if total > 0 { got as f64 / total as f64 } else { 0.0 },
        total_bytes: total,
        downloaded_bytes: got,
        uploaded_bytes: s.uploaded_bytes,
        down_bps: down,
        up_bps: up,
        eta_secs: eta,
        known_peers,
        peers,
        error: s.error.clone(),
        kind,
        category: meta.category.clone(),
        tags: meta.tags.clone(),
        added_on: meta.added_on,
        completed_on: meta.completed_on,
        active_secs: meta.active_secs,
        save_path: t.output_folder().display().to_string(),
        trackers,
        queue_pos: meta.queue_pos,
    }
}

#[tauri::command]
pub fn snapshot(app: State<'_, App>) -> Snapshot {
    let mut store = app.store.lock().unwrap();
    let mut dirty = false;
    let mut next = crate::queue::next_pos(&store);
    let handles: Vec<(usize, Arc<ManagedTorrent>)> = app
        .session
        .with_torrents(|it| it.map(|(id, t)| (id, t.clone())).collect());
    let mut torrents: Vec<TorrentInfo> = handles
        .iter()
        .map(|(id, t)| {
            let m = store.torrents.entry(t.info_hash().as_string()).or_insert_with(|| {
                dirty = true;
                next += 1;
                Meta {
                    queue_pos: next - 1,
                    added_on: now(),
                    ..Default::default()
                }
            });
            let mut info = info_of(*id, t, m, detect_kind(&app, t));
            if info.finished && m.completed_on == 0 {
                m.completed_on = now();
                info.completed_on = m.completed_on;
                dirty = true;
            }
            info
        })
        .collect();
    torrents.sort_by_key(|t| t.id);
    if dirty {
        app.save(&store);
    }
    let (free, total) = disk_space(Path::new(&store.settings.download_dir));
    Snapshot {
        torrents,
        disk_free: free,
        disk_total: total,
        categories: store.categories.clone(),
        tags: store.tags.clone(),
        tracker_list: store.tracker_list.clone(),
        search_history: store.search_history.clone(),
        settings: store.settings.clone(),
        restart_required: restart_needed(&app.startup, &store.settings),
        feed_status: store
            .feed_state
            .iter()
            .map(|(k, f)| {
                let status = FeedStatus {
                    last_checked: f.last_checked,
                    last_error: f.last_error.clone(),
                    added_total: f.added_total,
                    recent: f.recent.clone(),
                };
                (k.clone(), status)
            })
            .collect(),
        watch_status: store
            .watch_state
            .iter()
            .map(|(k, w)| {
                let status = WatchStatus {
                    last_scan: w.last_scan,
                    last_error: w.last_error.clone(),
                    added_total: w.added_total,
                };
                (k.clone(), status)
            })
            .collect(),
    }
}

#[cfg(windows)]
pub fn disk_space(p: &Path) -> (u64, u64) {
    use std::os::windows::ffi::OsStrExt;
    extern "system" {
        fn GetDiskFreeSpaceExW(
            dir: *const u16,
            avail: *mut u64,
            total: *mut u64,
            free: *mut u64,
        ) -> i32;
    }
    let w: Vec<u16> = p.as_os_str().encode_wide().chain(Some(0)).collect();
    let (mut a, mut t, mut f) = (0u64, 0u64, 0u64);
    unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut a, &mut t, &mut f) };
    (a, t)
}

#[cfg(not(windows))]
pub fn disk_space(_: &Path) -> (u64, u64) {
    (0, 0)
}

// ---------------------------------------------------------------- details

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOut {
    index: usize,
    path: String,
    size: u64,
    done: u64,
    included: bool,
    /// 0 skip, 1 normal, 2 high, 3 maximum
    priority: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerOut {
    addr: String,
    client: Option<String>,
    kind: Option<String>,
    downloaded: u64,
    uploaded: u64,
    errors: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    files: Vec<FileOut>,
    peers: Vec<PeerOut>,
    piece_len: u64,
    pieces: u64,
    comment: Option<String>,
    created_by: Option<String>,
    created_on: Option<u64>,
    private: bool,
}

#[tauri::command]
pub fn details(app: State<'_, App>, id: usize) -> Result<Details, String> {
    let t = handle(&app, id)?;
    let stats = t.stats();
    let meta = app
        .store
        .lock()
        .unwrap()
        .torrents
        .get(&t.info_hash().as_string())
        .cloned()
        .unwrap_or_default();
    let (files, piece_len) = t
        .with_metadata(|m| {
            let files: Vec<FileOut> = m
                .file_infos
                .iter()
                .enumerate()
                .map(|(i, f)| FileOut {
                    index: i,
                    path: f.relative_filename.to_string_lossy().replace('\\', "/"),
                    size: f.len,
                    done: stats.file_progress.get(i).copied().unwrap_or(0),
                    included: prio_of(&meta, i) > 0,
                    priority: prio_of(&meta, i),
                })
                .collect();
            (files, m.info.info().piece_length as u64)
        })
        .unwrap_or((vec![], 0));
    let (comment, created_by, created_on) = t
        .with_metadata(|m| {
            librqbit::torrent_from_bytes(&m.torrent_bytes)
                .map(|tf| {
                    let txt = |b: &Option<librqbit::ByteBuf>| {
                        b.as_ref()
                            .map(|v| String::from_utf8_lossy(v.as_ref()).trim().to_string())
                            .filter(|v| !v.is_empty())
                    };
                    (txt(&tf.comment), txt(&tf.created_by), tf.creation_date.map(|d| d as u64))
                })
                .unwrap_or((None, None, None))
        })
        .unwrap_or((None, None, None));
    let private = t.with_metadata(|m| m.info.info().private).unwrap_or(false);
    let mut peers = vec![];
    if let Some(live) = t.live() {
        let snap = live.per_peer_stats_snapshot(Default::default());
        for (addr, p) in snap.peers {
            peers.push(PeerOut {
                addr,
                client: p.client_name,
                kind: p
                    .conn_kind
                    .and_then(|k| serde_json::to_value(k).ok())
                    .and_then(|v| v.as_str().map(str::to_owned)),
                downloaded: p.counters.fetched_bytes,
                uploaded: p.counters.uploaded_bytes,
                errors: p.counters.errors,
            });
        }
        peers.sort_by_key(|p| std::cmp::Reverse(p.downloaded));
    }
    Ok(Details {
        pieces: if piece_len > 0 {
            stats.total_bytes.div_ceil(piece_len)
        } else {
            0
        },
        files,
        peers,
        piece_len,
        comment,
        created_by,
        created_on,
        private,
    })
}

pub fn handle(app: &App, id: usize) -> Result<Arc<ManagedTorrent>, String> {
    app.session
        .get(TorrentIdOrHash::Id(id))
        .ok_or_else(|| "torrent not found".to_string())
}

#[tauri::command]
pub async fn pause(app: State<'_, App>, ids: Vec<usize>) -> Result<(), String> {
    pause_ids(&app, ids).await
}

#[tauri::command]
pub async fn resume(app: State<'_, App>, ids: Vec<usize>) -> Result<(), String> {
    resume_ids(&app, ids).await
}

pub async fn pause_ids(app: &App, ids: Vec<usize>) -> Result<(), String> {
    for id in ids {
        let h = handle(app, id)?;
        app.with_store(|s| {
            let m = s.torrents.entry(h.info_hash().as_string()).or_default();
            m.user_stopped = true;
            m.force_start = false;
            m.queued = false;
        });
        if !h.is_paused() {
            app.session.pause(&h).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub async fn resume_ids(app: &App, ids: Vec<usize>) -> Result<(), String> {
    for id in ids {
        let h = handle(app, id)?;
        let hash = h.info_hash().as_string();
        let (max, queued, finished) = {
            let g = app.store.lock().unwrap();
            let m = g.torrents.get(&hash);
            (
                g.settings.max_active_downloads,
                m.is_some_and(|m| m.queued),
                m.is_some_and(|m| info_of(id, &h, m, "other").finished),
            )
        };
        // No free slot: wait in the queue instead of starting and being paused again.
        let full = h.is_paused() && !queued && !finished && max > 0 && crate::queue::active_count(app) >= max;
        app.with_store(|s| {
            let m = s.torrents.entry(hash).or_default();
            m.user_stopped = false;
            if queued {
                m.force_start = true; // jump the queue
                m.queued = false;
            } else if full {
                m.queued = true;
            }
        });
        if !full {
            app.session.unpause(&h).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn remove(app: State<'_, App>, ids: Vec<usize>, delete_files: bool) -> Result<(), String> {
    for id in ids {
        let hash = handle(&app, id).ok().map(|h| h.info_hash().as_string());
        app.session
            .delete(TorrentIdOrHash::Id(id), delete_files)
            .await
            .map_err(|e| e.to_string())?;
        if let Some(h) = hash {
            app.with_store(|s| {
                s.torrents.remove(&h);
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_is_the_biggest_known_type() {
        let paths = ["a/movie.mkv".to_string(), "a/cover.jpg".to_string(), "a/readme.nfo".to_string()];
        assert_eq!(kind_from_paths(&paths, &[900, 50, 10]), "videos");
        assert_eq!(kind_from_paths(&["x.unknown".to_string()], &[5]), "other");
    }
}
