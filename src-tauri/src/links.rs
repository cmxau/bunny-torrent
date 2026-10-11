//! Incoming magnet links and .torrent files (command line, single-instance hand-off, frontend pickup).

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::{idle::dbg_log, store::App};

#[derive(Serialize, Clone)]
pub struct Incoming {
    /// "magnet" or "file"
    kind: &'static str,
    value: String,
}

/// Picks magnet links and .torrent paths out of command-line arguments (how Windows hands us a clicked link).
pub fn parse_args(args: &[String]) -> Vec<Incoming> {
    args.iter()
        .filter_map(|a| {
            let a = a.trim().trim_matches('"');
            if a.len() > 8 && a[..8].eq_ignore_ascii_case("magnet:?") {
                Some(Incoming { kind: "magnet", value: a.to_string() })
            } else if a.to_ascii_lowercase().ends_with(".torrent") && Path::new(a).is_file() {
                Some(Incoming { kind: "file", value: a.to_string() })
            } else {
                None
            }
        })
        .collect()
}

pub fn push_incoming(app: &AppHandle, items: Vec<Incoming>) {
    dbg_log(&format!("push_incoming: {} item(s)", items.len()));
    if items.is_empty() {
        return;
    }
    if let Some(st) = app.try_state::<App>() {
        st.incoming.lock().unwrap().extend(items.iter().cloned());
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        crate::idle::sync_idle_state(&w.as_ref().window());
    }
    let _ = app.emit("incoming", ());
}

#[tauri::command]
pub fn take_incoming(app: State<'_, App>) -> Vec<Incoming> {
    let v = std::mem::take(&mut *app.incoming.lock().unwrap());
    if !v.is_empty() {
        dbg_log(&format!("take_incoming: frontend took {} item(s)", v.len()));
    }
    v
}

#[tauri::command]
pub fn default_handler_status(handle: AppHandle) -> bool {
    handle.deep_link().is_registered("magnet").unwrap_or(false)
}
