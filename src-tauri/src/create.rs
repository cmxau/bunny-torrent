//! Create a .torrent from a file or folder, optionally seeding it right away.

use std::path::{Path, PathBuf};

use librqbit::{
    spawn_utils::BlockingSpawner, AddTorrent, AddTorrentOptions, AddTorrentResponse, CreateTorrentOptions,
    CreateTorrentResult,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::store::{now, App, Meta};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReq {
    source: String,
    save_path: Option<String>,
    trackers: Vec<String>,
    comment: Option<String>,
    piece_length_kib: Option<u32>,
    start_seeding: bool,
    category: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    torrent_path: String,
    info_hash: String,
    magnet: String,
    name: String,
    total_bytes: u64,
}

/// Hashes the content on a blocking thread (the engine's creator is synchronous inside).
async fn build(
    source: PathBuf,
    trackers: Vec<String>,
    piece_kib: Option<u32>,
    comment: Option<String>,
) -> Result<CreateTorrentResult, String> {
    let handle = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        handle.block_on(async {
            let opts = CreateTorrentOptions {
                trackers,
                piece_length: piece_kib.filter(|k| *k > 0).map(|k| k.saturating_mul(1024)),
                ..Default::default()
            };
            let mut res = librqbit::create_torrent(&source, opts, &BlockingSpawner::new(1))
                .await
                .map_err(|e| e.to_string())?;
            // The comment sits outside the info dictionary, so the info-hash is unaffected.
            res.meta.comment = comment.map(|c| c.into_bytes().into());
            Ok(res)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

pub async fn create(app: &App, req: CreateReq) -> Result<CreateResult, String> {
    let source = PathBuf::from(req.source.trim());
    if !source.exists() {
        return Err("source not found".into());
    }
    let trackers: Vec<String> = req.trackers.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    let comment = req.comment.filter(|c| !c.trim().is_empty());
    let res = build(source.clone(), trackers, req.piece_length_kib, comment).await?;
    let bytes = res.as_bytes().map_err(|e| e.to_string())?;
    let torrent_path = match req.save_path.filter(|p| !p.trim().is_empty()) {
        Some(p) => PathBuf::from(p),
        None => {
            let mut s = source.clone().into_os_string();
            s.push(".torrent");
            PathBuf::from(s)
        }
    };
    std::fs::write(&torrent_path, &bytes).map_err(|e| e.to_string())?;

    let info = &res.meta.info.data;
    let name = info.name.as_ref().map(|n| String::from_utf8_lossy(n.as_ref()).into_owned()).unwrap_or_default();
    let total_bytes = match (&info.length, &info.files) {
        (Some(l), _) => *l,
        (None, Some(fs)) => fs.iter().map(|f| f.length).sum(),
        _ => 0,
    };
    let result = CreateResult {
        torrent_path: torrent_path.display().to_string(),
        info_hash: res.info_hash().as_string(),
        magnet: res.as_magnet().to_string(),
        name,
        total_bytes,
    };

    if req.start_seeding {
        seed(app, bytes.to_vec(), &source, req.category).await?;
    }
    Ok(result)
}

/// Adds the new torrent so the engine verifies the existing data and seeds it.
async fn seed(app: &App, torrent: Vec<u8>, source: &Path, category: Option<String>) -> Result<(), String> {
    let full = source.canonicalize().map_err(|e| e.to_string())?;
    let parent = full.parent().ok_or("source has no parent folder")?;
    let resp = app
        .session
        .add_torrent(
            AddTorrent::from_bytes(torrent),
            Some(AddTorrentOptions {
                overwrite: true,
                output_folder: Some(parent.display().to_string()),
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
    if let AddTorrentResponse::Added(_, h) = resp {
        let hash = h.info_hash().as_string();
        app.with_store(|s| {
            let queue_pos = crate::queue::next_pos(s);
            s.torrents.insert(hash, Meta { queue_pos, category, added_on: now(), ..Default::default() });
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn create_torrent(app: State<'_, App>, req: CreateReq) -> Result<CreateResult, String> {
    create(&app, req).await
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
        time::Duration,
    };

    use librqbit::{Session, SessionOptions};

    use crate::store::{Settings, Store};

    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "bunny-create-{tag}-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    async fn test_app(root: &Path) -> App {
        let session = Session::new_with_opts(
            root.join("dl"),
            SessionOptions { dht: None, persistence: None, listen: None, disable_trackers: true, ..Default::default() },
        )
        .await
        .unwrap();
        App {
            session,
            store: Arc::new(Mutex::new(Store::default())),
            store_path: root.join("store.json"),
            startup: Settings::default(),
            kinds: Mutex::new(HashMap::new()),
            previews: Mutex::new(HashMap::new()),
            incoming: Mutex::new(vec![]),
        }
    }

    fn req(source: &Path, seed: bool) -> CreateReq {
        CreateReq {
            source: source.display().to_string(),
            save_path: None,
            trackers: vec!["http://tracker.example/announce".into()],
            comment: Some("hello".into()),
            piece_length_kib: Some(16),
            start_seeding: seed,
            category: None,
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn creates_a_valid_torrent_for_a_folder() {
        let root = temp("dir");
        let folder = root.join("Album");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("a.txt"), vec![1u8; 40_000]).unwrap();
        std::fs::write(folder.join("b.bin"), vec![2u8; 5_000]).unwrap();
        let app = test_app(&root).await;

        let r = create(&app, req(&folder, false)).await.unwrap();
        assert_eq!(r.name, "Album");
        assert_eq!(r.total_bytes, 45_000);
        assert!(r.torrent_path.ends_with("Album.torrent"));
        assert!(r.magnet.starts_with("magnet:?xt=urn:btih:"));

        let bytes = std::fs::read(&r.torrent_path).unwrap();
        let t = librqbit::torrent_from_bytes(&bytes).unwrap();
        assert_eq!(t.info_hash.as_string(), r.info_hash);
        assert_eq!(t.info.data.name.as_ref().unwrap().as_ref(), b"Album");
        assert_eq!(t.info.data.piece_length, 16 * 1024);
        let mut files: Vec<(String, u64)> = t
            .info
            .data
            .files
            .as_ref()
            .unwrap()
            .iter()
            .map(|f| {
                let p: Vec<String> = f.path.iter().map(|p| String::from_utf8_lossy(p.as_ref()).into_owned()).collect();
                (p.join("/"), f.length)
            })
            .collect();
        files.sort();
        assert_eq!(files, vec![("a.txt".to_string(), 40_000), ("b.bin".to_string(), 5_000)]);
        assert_eq!(t.comment.as_ref().unwrap().as_ref(), b"hello");
        assert_eq!(app.session.with_torrents(|it| it.count()), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn seeding_a_created_file_finishes_after_verification() {
        let root = temp("seed");
        let file = root.join("movie.bin");
        std::fs::write(&file, vec![9u8; 100_000]).unwrap();
        let app = test_app(&root).await;

        let r = create(&app, req(&file, true)).await.unwrap();
        let handle = app.session.with_torrents(|it| it.into_iter().next().map(|(_, t)| t.clone())).expect("added");
        assert_eq!(handle.info_hash().as_string(), r.info_hash);
        let mut done = false;
        for _ in 0..100 {
            if handle.stats().finished {
                done = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(done, "engine should verify existing data as complete");
        assert!(app.store.lock().unwrap().torrents.contains_key(&r.info_hash));
        let _ = std::fs::remove_dir_all(&root);
    }
}
