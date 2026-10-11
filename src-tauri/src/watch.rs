//! Watch folders: .torrent files dropped into a folder are added, then renamed so they are not picked up again.

use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use tauri::Manager;

use crate::{
    add::{add_core, AddReq},
    store::{now, App, WatchFolder},
};

/// Files younger than this may still be downloading.
const SETTLE_SECS: u64 = 5;

/// A finished-looking `*.torrent` file: the right extension and not modified in the last `min_age` seconds.
pub fn should_pick(name: &str, age_secs: u64, min_age: u64) -> bool {
    name.to_lowercase().ends_with(".torrent") && age_secs >= min_age
}

fn renamed(path: &Path, suffix: &str) -> PathBuf {
    let mut n = path.file_name().unwrap_or_default().to_os_string();
    n.push(suffix);
    path.with_file_name(n)
}

/// Adds every ready .torrent in the folder; returns how many were taken up, or why the folder couldn't be read.
pub async fn scan_folder(app: &App, f: &WatchFolder, min_age: u64) -> Result<u32, String> {
    let rd = std::fs::read_dir(&f.path).map_err(|e| format!("{}: {e}", f.path))?;
    let mut ready: Vec<PathBuf> = rd
        .flatten()
        .filter_map(|e| {
            let md = e.metadata().ok().filter(|m| m.is_file())?;
            let age = SystemTime::now().duration_since(md.modified().ok()?).unwrap_or_default().as_secs();
            should_pick(&e.file_name().to_string_lossy(), age, min_age).then(|| e.path())
        })
        .collect();
    ready.sort();
    let mut added = 0;
    for p in ready {
        let req = AddReq {
            paths: vec![p.display().to_string()],
            category: f.category.clone(),
            paused: f.paused.then_some(true),
            ..Default::default()
        };
        // "already in your list" is a success too
        let ok = match add_core(app, req).await {
            Ok(r) => {
                added += r.added;
                true
            }
            Err(_) => false,
        };
        let _ = std::fs::rename(&p, renamed(&p, if ok { ".added" } else { ".failed" }));
    }
    Ok(added)
}

async fn scan_all(app: &App, folders: &[WatchFolder]) {
    for f in folders {
        let res = scan_folder(app, f, SETTLE_SECS).await;
        app.with_store_if(|s| {
            let st = s.watch_state.entry(f.path.clone()).or_default();
            st.last_scan = now();
            let err = res.as_ref().err().cloned();
            let changed = res.as_ref().is_ok_and(|n| *n > 0) || st.last_error != err;
            st.last_error = err;
            if let Ok(n) = &res {
                st.added_total += n;
            }
            changed
        });
    }
}

pub fn spawn(rt: &tokio::runtime::Handle, handle: tauri::AppHandle) {
    rt.spawn(async move {
        loop {
            let folders: Vec<WatchFolder> = match handle.try_state::<App>() {
                Some(app) => app.store.lock().unwrap().settings.watch_folders.iter().filter(|f| f.enabled).cloned().collect(),
                None => vec![],
            };
            if folders.is_empty() {
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }
            if let Some(app) = handle.try_state::<App>() {
                scan_all(&app, &folders).await;
            }
            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
        time::UNIX_EPOCH,
    };

    use librqbit::{Session, SessionOptions};

    use crate::store::{Settings, Store};

    #[test]
    fn picks_old_enough_torrent_files_only() {
        assert!(should_pick("a.torrent", 5, 5));
        assert!(should_pick("A.TORRENT", 100, 5));
        assert!(!should_pick("a.torrent", 4, 5));
        assert!(!should_pick("a.torrent.added", 100, 5));
        assert!(!should_pick("a.torrent.failed", 100, 5));
        assert!(!should_pick("notes.txt", 100, 5));
    }

    #[test]
    fn renamed_appends_the_suffix() {
        let p = renamed(Path::new("D:/w/x.torrent"), ".added");
        assert_eq!(p.file_name().unwrap(), "x.torrent.added");
    }

    #[tokio::test]
    async fn real_engine_adds_a_dropped_torrent_and_renames_it() {
        let root = std::env::temp_dir().join(format!(
            "bunny-watch-test-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let watch = root.join("watch");
        std::fs::create_dir_all(&watch).unwrap();
        let session = Session::new_with_opts(
            root.join("dl"),
            SessionOptions { dht: None, persistence: None, listen: None, disable_trackers: true, ..Default::default() },
        )
        .await
        .unwrap();
        let mut store = Store::default();
        store.settings.download_dir = root.join("dl").display().to_string();
        let app = App {
            session,
            store: Arc::new(Mutex::new(store)),
            store_path: root.join("store.json"),
            startup: Settings::default(),
            kinds: Mutex::new(HashMap::new()),
            previews: Mutex::new(HashMap::new()),
            incoming: Mutex::new(vec![]),
        };
        let mut t: Vec<u8> = b"d4:infod6:lengthi100e4:name8:tiny.bin12:piece lengthi16384e6:pieces20:".to_vec();
        t.extend_from_slice(&[7u8; 20]);
        t.extend_from_slice(b"ee");
        std::fs::write(watch.join("tiny.torrent"), &t).unwrap();
        std::fs::write(watch.join("broken.torrent"), b"nope").unwrap();
        std::fs::write(watch.join("readme.txt"), b"x").unwrap();
        let folder = WatchFolder { path: watch.display().to_string(), paused: true, enabled: true, ..Default::default() };

        // the 5 s settle rule skips files that were just written
        assert_eq!(scan_folder(&app, &folder, SETTLE_SECS).await.unwrap(), 0);
        assert!(watch.join("tiny.torrent").exists());

        assert_eq!(scan_folder(&app, &folder, 0).await.unwrap(), 1);
        assert!(watch.join("tiny.torrent.added").exists());
        assert!(!watch.join("tiny.torrent").exists());
        assert!(watch.join("broken.torrent.failed").exists());
        assert!(watch.join("readme.txt").exists());
        assert_eq!(app.session.with_torrents(|it| it.count()), 1);
        assert_eq!(app.store.lock().unwrap().torrents.len(), 1);

        let missing = WatchFolder { path: root.join("nope").display().to_string(), ..folder };
        assert!(scan_folder(&app, &missing, 0).await.is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
