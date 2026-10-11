//! Download queue: limits how many unfinished torrents run at once and lets the user reorder them.

use std::sync::{Arc, Mutex};

use librqbit::{ManagedTorrent, Session};
use tauri::State;

use crate::{
    store::{App, Store},
    torrents::info_of,
};

pub struct QItem {
    pub id: usize,
    pub pos: u32,
    pub force: bool,
    pub finished: bool,
    pub user_stopped: bool,
    pub running: bool,
}

#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    pub start: Vec<usize>,
    pub pause: Vec<usize>,
}

/// Which torrents to start and which to pause so that at most `max` non-forced ones run
/// (0 = unlimited). Forced torrents always run and never take a slot.
pub fn plan(items: &[QItem], max: u32) -> Plan {
    let mut wanted: Vec<&QItem> = items.iter().filter(|i| !i.finished && !i.user_stopped).collect();
    wanted.sort_by_key(|i| (!i.force, i.pos, i.id));
    let mut used = 0u32;
    let mut p = Plan::default();
    for i in wanted {
        let admitted = i.force || max == 0 || used < max;
        if admitted && !i.force {
            used += 1;
        }
        match (admitted, i.running) {
            (true, false) => p.start.push(i.id),
            (false, true) => p.pause.push(i.id),
            _ => {}
        }
    }
    p
}

/// New order of `order` after moving `ids` ("top" | "up" | "down" | "bottom"); the others keep
/// their relative order and ids not in `order` are ignored.
pub fn reorder(order: &[usize], ids: &[usize], to: &str) -> Vec<usize> {
    let sel = |id: &usize| ids.contains(id);
    let mut v = order.to_vec();
    match to {
        "top" => v = order.iter().filter(|i| sel(i)).chain(order.iter().filter(|i| !sel(i))).copied().collect(),
        "bottom" => v = order.iter().filter(|i| !sel(i)).chain(order.iter().filter(|i| sel(i))).copied().collect(),
        "up" => {
            for k in 1..v.len() {
                if sel(&v[k]) && !sel(&v[k - 1]) {
                    v.swap(k, k - 1);
                }
            }
        }
        "down" => {
            for k in (0..v.len().saturating_sub(1)).rev() {
                if sel(&v[k]) && !sel(&v[k + 1]) {
                    v.swap(k, k + 1);
                }
            }
        }
        _ => {}
    }
    v
}

pub fn next_pos(s: &Store) -> u32 {
    s.torrents.values().map(|m| m.queue_pos).max().unwrap_or(0) + 1
}

fn all_handles(session: &Session) -> Vec<(usize, Arc<ManagedTorrent>)> {
    session.with_torrents(|it| it.map(|(id, t)| (id, t.clone())).collect())
}

/// Number of unfinished, running, non-forced torrents (the ones that use queue slots).
pub fn active_count(app: &App) -> u32 {
    let handles = all_handles(&app.session);
    let g = app.store.lock().unwrap();
    handles
        .iter()
        .filter(|(id, t)| match g.torrents.get(&t.info_hash().as_string()) {
            Some(m) => !m.force_start && !t.is_paused() && !info_of(*id, t, m, "other").finished,
            None => false,
        })
        .count() as u32
}

/// Starts/pauses torrents to honour the active-download limit; returns true when the store changed.
pub async fn tick(session: &Arc<Session>, store: &Arc<Mutex<Store>>) -> bool {
    let handles = all_handles(session);
    let mut dirty = false;
    let (p, checking) = {
        let mut g = store.lock().unwrap();
        let max = g.settings.max_active_downloads;
        let mut items = vec![];
        let mut checking = vec![];
        for (id, t) in &handles {
            let Some(m) = g.torrents.get_mut(&t.info_hash().as_string()) else { continue };
            let info = info_of(*id, t, m, "other");
            if info.state == "errored" {
                continue;
            }
            let running = !t.is_paused();
            if running && m.queued {
                m.queued = false; // started by someone else
                dirty = true;
            }
            // A paused torrent the manager did not queue is stopped, not waiting.
            if !running && !m.queued && !m.force_start {
                continue;
            }
            if info.state == "checking" {
                checking.push(*id);
            }
            items.push(QItem {
                id: *id,
                pos: m.queue_pos,
                force: m.force_start,
                finished: info.finished,
                user_stopped: m.user_stopped,
                running,
            });
        }
        (plan(&items, max), checking)
    };
    for id in p.start {
        if let Some((_, t)) = handles.iter().find(|(i, _)| *i == id) {
            if session.unpause(t).await.is_ok() {
                if let Some(m) = store.lock().unwrap().torrents.get_mut(&t.info_hash().as_string()) {
                    m.queued = false;
                    dirty = true;
                }
            }
        }
    }
    for id in p.pause.into_iter().filter(|i| !checking.contains(i)) {
        if let Some((_, t)) = handles.iter().find(|(i, _)| *i == id) {
            if session.pause(t).await.is_ok() {
                if let Some(m) = store.lock().unwrap().torrents.get_mut(&t.info_hash().as_string()) {
                    m.queued = true;
                    dirty = true;
                }
            }
        }
    }
    dirty
}

#[tauri::command]
pub fn queue_move(app: State<'_, App>, ids: Vec<usize>, to: String) -> Result<(), String> {
    if !matches!(to.as_str(), "top" | "up" | "down" | "bottom") {
        return Err("unknown queue move".into());
    }
    let handles = all_handles(&app.session);
    app.with_store(|g| {
        // (queue_pos, id, hash, finished); the queue is the unfinished torrents, finished ones follow
        let mut rows: Vec<(u32, usize, String, bool)> = handles
            .iter()
            .filter_map(|(id, t)| {
                let hash = t.info_hash().as_string();
                let m = g.torrents.get(&hash)?;
                Some((m.queue_pos, *id, hash, info_of(*id, t, m, "other").finished))
            })
            .collect();
        rows.sort_by_key(|r| (r.0, r.1));
        let queue: Vec<usize> = rows.iter().filter(|r| !r.3).map(|r| r.1).collect();
        let order = reorder(&queue, &ids, &to)
            .into_iter()
            .chain(rows.iter().filter(|r| r.3).map(|r| r.1));
        for (n, id) in order.enumerate() {
            if let Some(r) = rows.iter().find(|r| r.1 == id) {
                if let Some(m) = g.torrents.get_mut(&r.2) {
                    m.queue_pos = n as u32 + 1;
                }
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn it(id: usize, pos: u32, force: bool, running: bool) -> QItem {
        QItem { id, pos, force, finished: false, user_stopped: false, running }
    }

    #[test]
    fn unlimited_starts_everything_wanted() {
        let mut items = vec![it(1, 1, false, false), it(2, 2, false, true)];
        items.push(QItem { finished: true, ..it(3, 3, false, false) });
        items.push(QItem { user_stopped: true, ..it(4, 4, false, false) });
        assert_eq!(plan(&items, 0), Plan { start: vec![1], pause: vec![] });
    }

    #[test]
    fn limit_pauses_overflow_and_starts_next() {
        let items = vec![it(1, 1, false, true), it(2, 2, false, true), it(3, 3, false, true), it(4, 4, false, false)];
        assert_eq!(plan(&items, 2), Plan { start: vec![], pause: vec![3] });
        let items = vec![it(1, 1, false, false), it(2, 2, false, true), it(3, 3, false, false)];
        assert_eq!(plan(&items, 2), Plan { start: vec![1], pause: vec![] });
        let items = vec![it(1, 1, false, true), it(2, 2, false, true), it(3, 3, false, false)];
        assert_eq!(plan(&items, 2), Plan::default());
    }

    #[test]
    fn forced_ignore_the_limit() {
        let items = vec![it(1, 1, false, true), it(2, 2, false, true), it(3, 9, true, false)];
        assert_eq!(plan(&items, 1), Plan { start: vec![3], pause: vec![2] });
    }

    #[test]
    fn moves() {
        let o = [1, 2, 3, 4, 5];
        assert_eq!(reorder(&o, &[4], "top"), vec![4, 1, 2, 3, 5]);
        assert_eq!(reorder(&o, &[2, 4], "bottom"), vec![1, 3, 5, 2, 4]);
        assert_eq!(reorder(&o, &[3, 5], "up"), vec![1, 3, 2, 5, 4]);
        assert_eq!(reorder(&o, &[1, 2], "up"), vec![1, 2, 3, 4, 5]);
        assert_eq!(reorder(&o, &[1, 4], "down"), vec![2, 1, 3, 5, 4]);
        assert_eq!(reorder(&o, &[4, 5], "down"), vec![1, 2, 3, 4, 5]);
        assert_eq!(reorder(&o, &[9], "top"), vec![1, 2, 3, 4, 5]);
    }
}

#[cfg(test)]
mod engine_tests {
    use super::*;
    use crate::store::{Meta, Store};
    use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, SessionOptions};

    /// A one-file torrent; the name makes each info hash unique. (Content hashes don't matter here.)
    fn tiny(name: &str) -> Vec<u8> {
        let mut t = format!("d4:infod6:lengthi100e4:name{}:{}12:piece lengthi16384e6:pieces20:", name.len(), name).into_bytes();
        t.extend_from_slice(&[9u8; 20]);
        t.extend_from_slice(b"ee");
        t
    }

    fn running(handles: &[Arc<ManagedTorrent>]) -> Vec<bool> {
        handles.iter().map(|h| !h.is_paused()).collect()
    }

    async fn settle(session: &Arc<Session>, store: &Arc<Mutex<Store>>) {
        for _ in 0..6 {
            tick(session, store).await;
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }

    #[tokio::test]
    async fn real_engine_honours_the_active_download_limit() {
        let root = std::env::temp_dir().join(format!(
            "bunny-queue-test-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let dl = root.join("dl");
        let session = Session::new_with_opts(
            dl.clone(),
            SessionOptions { dht: None, persistence: None, listen: None, disable_trackers: true, ..Default::default() },
        )
        .await
        .unwrap();

        let store = Arc::new(Mutex::new(Store::default()));
        store.lock().unwrap().settings.max_active_downloads = 1;
        let mut handles = vec![];
        for (i, name) in ["Qone", "Qtwo", "Qthree"].iter().enumerate() {
            let r = session
                .add_torrent(
                    AddTorrent::from_bytes(tiny(name)),
                    Some(AddTorrentOptions { overwrite: true, output_folder: Some(dl.display().to_string()), ..Default::default() }),
                )
                .await
                .unwrap();
            let AddTorrentResponse::Added(_, h) = r else { panic!("expected Added") };
            store.lock().unwrap().torrents.insert(
                h.info_hash().as_string(),
                Meta { queue_pos: i as u32 + 1, ..Default::default() },
            );
            handles.push(h);
        }
        let queued = |store: &Arc<Mutex<Store>>, h: &Arc<ManagedTorrent>| {
            store.lock().unwrap().torrents[&h.info_hash().as_string()].queued
        };

        // limit 1: only the first in the queue runs, the others are held back and marked queued
        settle(&session, &store).await;
        assert_eq!(running(&handles), vec![true, false, false]);
        assert!(!queued(&store, &handles[0]) && queued(&store, &handles[1]) && queued(&store, &handles[2]));

        // limit 2: the next one in line starts
        store.lock().unwrap().settings.max_active_downloads = 2;
        settle(&session, &store).await;
        assert_eq!(running(&handles), vec![true, true, false]);

        // the person stops the first one: it must stay stopped and the third takes its slot
        {
            let mut g = store.lock().unwrap();
            g.torrents.get_mut(&handles[0].info_hash().as_string()).unwrap().user_stopped = true;
        }
        session.pause(&handles[0]).await.unwrap();
        settle(&session, &store).await;
        assert_eq!(running(&handles), vec![false, true, true]);
        assert!(!queued(&store, &handles[0]), "a user-stopped torrent is stopped, not queued");

        // limit back to unlimited: nothing queued remains (the stopped one stays stopped)
        store.lock().unwrap().settings.max_active_downloads = 0;
        settle(&session, &store).await;
        assert_eq!(running(&handles), vec![false, true, true]);

        let _ = std::fs::remove_dir_all(&root);
    }
}
