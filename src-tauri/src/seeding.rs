//! Stops (pauses or removes) torrents that have seeded long enough or far enough.

use std::sync::{Arc, Mutex};

use librqbit::{api::TorrentIdOrHash, ManagedTorrent, Session};

use crate::{
    store::{now, Store},
    torrents::info_of,
};

/// True when the ratio limit (> 0) or the seeding-time limit (> 0 minutes) has been reached.
pub fn limit_reached(
    ratio_limit: f32,
    time_limit_mins: u32,
    uploaded: u64,
    total: u64,
    completed_on: u64,
    now: u64,
) -> bool {
    let by_ratio = ratio_limit > 0.0 && total > 0 && uploaded as f64 / total as f64 >= ratio_limit as f64;
    let by_time =
        time_limit_mins > 0 && completed_on > 0 && now.saturating_sub(completed_on) >= time_limit_mins as u64 * 60;
    by_ratio || by_time
}

/// Applies the seeding rules; returns true when the store changed.
pub async fn tick(session: &Arc<Session>, store: &Arc<Mutex<Store>>) -> bool {
    let handles: Vec<(usize, Arc<ManagedTorrent>)> =
        session.with_torrents(|it| it.map(|(id, t)| (id, t.clone())).collect());
    let mut dirty = false;
    let mut hits: Vec<(usize, Arc<ManagedTorrent>, String, bool)> = vec![];
    {
        let mut g = store.lock().unwrap();
        let (ratio, mins, remove) = (
            g.settings.seed_ratio_limit,
            g.settings.seed_time_limit_mins,
            g.settings.seed_limit_action == "remove",
        );
        let t_now = now();
        for (id, t) in &handles {
            let hash = t.info_hash().as_string();
            let Some(m) = g.torrents.get_mut(&hash) else { continue };
            let info = info_of(*id, t, m, "other");
            if !info.finished {
                continue;
            }
            if m.completed_on == 0 {
                m.completed_on = t_now;
                dirty = true;
            }
            if m.seed_limit_hit || info.state != "seeding" {
                continue;
            }
            if limit_reached(ratio, mins, info.uploaded_bytes, info.total_bytes, m.completed_on, t_now) {
                hits.push((*id, t.clone(), hash, remove));
            }
        }
    }
    for (id, t, hash, remove) in hits {
        if remove {
            if session.delete(TorrentIdOrHash::Id(id), false).await.is_ok() {
                store.lock().unwrap().torrents.remove(&hash);
                dirty = true;
            }
        } else if session.pause(&t).await.is_ok() {
            if let Some(m) = store.lock().unwrap().torrents.get_mut(&hash) {
                m.seed_limit_hit = true;
                dirty = true;
            }
        }
    }
    dirty
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_by_default() {
        assert!(!limit_reached(0.0, 0, 10_000, 100, 1, 1_000_000));
    }

    #[test]
    fn ratio_limit() {
        assert!(limit_reached(1.5, 0, 150, 100, 0, 0));
        assert!(!limit_reached(1.5, 0, 149, 100, 0, 0));
        assert!(!limit_reached(1.0, 0, 5, 0, 0, 0)); // no size, no ratio
    }

    #[test]
    fn time_limit() {
        assert!(limit_reached(0.0, 10, 0, 100, 1000, 1600));
        assert!(!limit_reached(0.0, 10, 0, 100, 1000, 1599));
        assert!(!limit_reached(0.0, 10, 0, 100, 0, 5000)); // unknown completion time
    }
}

#[cfg(test)]
mod engine_tests {
    use super::*;
    use crate::store::{Meta, Store};
    use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, SessionOptions};

    /// 100 bytes of 'a' as a one-file torrent, with the real SHA-1 of that data so the engine sees it as complete.
    fn complete_torrent() -> Vec<u8> {
        let mut t = b"d4:infod6:lengthi100e4:name6:Seedme12:piece lengthi16384e6:pieces20:".to_vec();
        let hash: Vec<u8> = (0..20)
            .map(|i| u8::from_str_radix(&"7f9000257a4918d7072655ea468540cdcbd42e0c"[i * 2..i * 2 + 2], 16).unwrap())
            .collect();
        t.extend_from_slice(&hash);
        t.extend_from_slice(b"ee");
        t
    }

    async fn setup(root: &std::path::Path) -> (Arc<Session>, Arc<ManagedTorrent>, Arc<Mutex<Store>>) {
        let dl = root.join("dl");
        std::fs::create_dir_all(&dl).unwrap();
        std::fs::write(dl.join("Seedme"), vec![b'a'; 100]).unwrap();
        let session = Session::new_with_opts(
            dl.clone(),
            SessionOptions { dht: None, persistence: None, listen: None, disable_trackers: true, ..Default::default() },
        )
        .await
        .unwrap();
        let r = session
            .add_torrent(
                AddTorrent::from_bytes(complete_torrent()),
                Some(AddTorrentOptions { overwrite: true, output_folder: Some(dl.display().to_string()), ..Default::default() }),
            )
            .await
            .unwrap();
        let AddTorrentResponse::Added(_, h) = r else { panic!("expected Added") };
        // wait until the engine has verified the data and reports it finished
        for _ in 0..40 {
            if h.stats().finished {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        assert!(h.stats().finished, "the engine should see the torrent as complete");
        let store = Arc::new(Mutex::new(Store::default()));
        store.lock().unwrap().torrents.insert(h.info_hash().as_string(), Meta::default());
        (session, h, store)
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!(
            "bunny-seed-{name}-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[tokio::test]
    async fn real_engine_pauses_a_torrent_that_has_seeded_long_enough() {
        let root = tmp("pause");
        let (session, h, store) = setup(&root).await;
        let hash = h.info_hash().as_string();
        {
            let mut g = store.lock().unwrap();
            g.settings.seed_time_limit_mins = 30;
            g.settings.seed_limit_action = "pause".into();
            g.torrents.get_mut(&hash).unwrap().completed_on = now() - 3600; // finished an hour ago
        }
        assert!(tick(&session, &store).await, "the tick should have acted");
        assert!(h.is_paused(), "the torrent should be paused");
        assert!(store.lock().unwrap().torrents[&hash].seed_limit_hit);

        // the person resumes it: the rule must not fire again
        session.unpause(&h).await.unwrap();
        tick(&session, &store).await;
        assert!(!h.is_paused(), "a resumed torrent keeps seeding");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn real_engine_removes_but_keeps_the_files_when_asked() {
        let root = tmp("remove");
        let (session, h, store) = setup(&root).await;
        let hash = h.info_hash().as_string();
        {
            let mut g = store.lock().unwrap();
            g.settings.seed_time_limit_mins = 1;
            g.settings.seed_limit_action = "remove".into();
            g.torrents.get_mut(&hash).unwrap().completed_on = now() - 600;
        }
        tick(&session, &store).await;
        assert_eq!(session.with_torrents(|it| it.count()), 0, "removed from the list");
        assert!(!store.lock().unwrap().torrents.contains_key(&hash));
        assert!(root.join("dl").join("Seedme").exists(), "the downloaded file must be kept");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn real_engine_leaves_a_torrent_alone_while_under_the_limits() {
        let root = tmp("under");
        let (session, h, store) = setup(&root).await;
        let hash = h.info_hash().as_string();
        {
            let mut g = store.lock().unwrap();
            g.settings.seed_time_limit_mins = 600;
            g.settings.seed_ratio_limit = 5.0;
            g.torrents.get_mut(&hash).unwrap().completed_on = now() - 60;
        }
        tick(&session, &store).await;
        assert!(!h.is_paused());
        assert!(!store.lock().unwrap().torrents[&hash].seed_limit_hit);
        let _ = std::fs::remove_dir_all(&root);
    }
}
