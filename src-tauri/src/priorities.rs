//! File priorities: which files the engine should fetch right now.

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use librqbit::{ManagedTorrent, Session, TorrentStatsState};
use tauri::State;

use crate::{store::App, torrents::handle};

/// Which files the engine should fetch right now: the highest-priority tier that still has
/// unfinished data (Maximum, then High, then Normal). Skipped files are never included.
pub fn desired_set(files: &[(u64, u64, u8)]) -> HashSet<usize> {
    let wanted: Vec<(usize, &(u64, u64, u8))> =
        files.iter().enumerate().filter(|(_, f)| f.2 > 0).collect();
    let top = wanted.iter().filter(|(_, f)| f.1 < f.0).map(|(_, f)| f.2).max();
    match top {
        Some(top) => wanted
            .iter()
            .filter(|(_, f)| f.2 == top && f.1 < f.0)
            .map(|(i, _)| *i)
            .collect(),
        None => wanted.iter().map(|(i, _)| *i).collect(),
    }
}

pub async fn apply_priorities(
    session: &Arc<Session>,
    h: &Arc<ManagedTorrent>,
    prios: &HashMap<usize, u8>,
) -> Result<(), String> {
    let s = h.stats();
    if matches!(
        s.state,
        TorrentStatsState::Initializing { .. } | TorrentStatsState::Error
    ) {
        return Ok(());
    }
    let files: Vec<(u64, u64, u8)> = match h.with_metadata(|m| {
        m.file_infos
            .iter()
            .enumerate()
            .map(|(i, f)| {
                (
                    f.len,
                    s.file_progress.get(i).copied().unwrap_or(0),
                    *prios.get(&i).unwrap_or(&1),
                )
            })
            .collect()
    }) {
        Ok(v) => v,
        Err(_) => return Ok(()), // metadata not resolved yet; the scheduler retries
    };
    let custom = prios.values().any(|p| *p != 1);
    let want: HashSet<usize> = if custom {
        desired_set(&files)
    } else {
        (0..files.len()).collect()
    };
    if want.is_empty() {
        return Ok(());
    }
    let cur: HashSet<usize> = h
        .only_files()
        .map(|v| v.into_iter().collect())
        .unwrap_or_else(|| (0..files.len()).collect());
    if cur == want {
        return Ok(());
    }
    let paused = matches!(s.state, TorrentStatsState::Paused);
    // A torrent whose selected files are all done has been closed off for writing; reopen it.
    let bounce = s.finished && !paused;
    if bounce {
        session.pause(h).await.map_err(|e| e.to_string())?;
    }
    let r = session
        .update_only_files(h, &want)
        .await
        .map_err(|e| e.to_string());
    if bounce {
        session.unpause(h).await.map_err(|e| e.to_string())?;
    }
    r
}

#[tauri::command]
pub async fn set_file_priority(
    app: State<'_, App>,
    id: usize,
    files: Vec<usize>,
    priority: u8,
) -> Result<(), String> {
    if priority > 3 {
        return Err("invalid priority".into());
    }
    let h = handle(&app, id)?;
    let count = h
        .with_metadata(|m| m.file_infos.len())
        .map_err(|_| "file list isn't available yet".to_string())?;
    let hash = h.info_hash().as_string();
    let prios = {
        let mut g = app.store.lock().unwrap();
        let mut next = g
            .torrents
            .get(&hash)
            .map(|m| m.file_prio.clone())
            .unwrap_or_default();
        for f in files.into_iter().filter(|f| *f < count) {
            if priority == 1 {
                next.remove(&f);
            } else {
                next.insert(f, priority);
            }
        }
        if (0..count).all(|i| *next.get(&i).unwrap_or(&1) == 0) {
            return Err("At least one file has to be downloaded".into());
        }
        g.torrents.entry(hash).or_default().file_prio = next.clone();
        app.save(&g);
        next
    };
    apply_priorities(&app.session, &h, &prios).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(v: &[usize]) -> HashSet<usize> {
        v.iter().copied().collect()
    }

    #[test]
    fn maximum_downloads_before_normal() {
        // (len, done, prio)
        let f = [(10, 0, 1), (10, 0, 3), (10, 0, 2)];
        assert_eq!(desired_set(&f), set(&[1]));
    }

    #[test]
    fn moves_to_next_tier_when_top_is_done() {
        let f = [(10, 0, 1), (10, 10, 3), (10, 0, 2)];
        assert_eq!(desired_set(&f), set(&[2]));
        let f = [(10, 0, 1), (10, 10, 3), (10, 10, 2)];
        assert_eq!(desired_set(&f), set(&[0]));
    }

    #[test]
    fn skipped_files_are_never_selected() {
        let f = [(10, 0, 0), (10, 4, 1)];
        assert_eq!(desired_set(&f), set(&[1]));
        let f = [(10, 0, 0), (10, 10, 1)];
        assert_eq!(desired_set(&f), set(&[1]));
    }

    #[test]
    fn same_tier_downloads_together() {
        let f = [(10, 0, 2), (10, 3, 2), (10, 0, 1)];
        assert_eq!(desired_set(&f), set(&[0, 1]));
    }
}
