//! "Download complete" notifications for torrents that finish while the app runs.

use std::collections::HashSet;

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Names of torrents (`(hash, name, finished)`) that just went from unfinished to finished.
/// `seen` holds the hashes already known to be finished; the first call (`first`) only seeds it.
pub fn newly_finished(seen: &mut HashSet<String>, current: &[(String, String, bool)], first: bool) -> Vec<String> {
    let mut out = vec![];
    for (hash, name, finished) in current {
        if *finished {
            if seen.insert(hash.clone()) && !first {
                out.push(name.clone());
            }
        } else {
            seen.remove(hash);
        }
    }
    out
}

pub fn show_complete(app: &AppHandle, name: &str) {
    let _ = app.notification().builder().title("Download complete").body(name).show();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(h: &str, f: bool) -> (String, String, bool) {
        (h.into(), format!("name-{h}"), f)
    }

    #[test]
    fn only_transitions_after_the_first_tick_notify() {
        let mut seen = HashSet::new();
        assert!(newly_finished(&mut seen, &[t("a", true), t("b", false)], true).is_empty());
        assert!(newly_finished(&mut seen, &[t("a", true), t("b", false)], false).is_empty());
        assert_eq!(newly_finished(&mut seen, &[t("a", true), t("b", true)], false), vec!["name-b"]);
        assert!(newly_finished(&mut seen, &[t("a", true), t("b", true)], false).is_empty());
        // a torrent that is re-checked and finishes again notifies again
        newly_finished(&mut seen, &[t("b", false)], false);
        assert_eq!(newly_finished(&mut seen, &[t("b", true)], false), vec!["name-b"]);
    }
}
