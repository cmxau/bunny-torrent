//! System tray icon (toggle/pause/resume/quit), live speed tooltip, show/hide and autostart sync.

use std::time::Duration;

use librqbit::TorrentStatsState;
use tauri::{
    image::Image,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::{
    idle::{dbg_log, sync_idle_state},
    store::App,
    torrents,
};

const TRAY_ID: &str = "main";

fn speed(bps: u64) -> String {
    let units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let mut v = bps as f64;
    let mut i = 0;
    while v >= 1024.0 && i < units.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 || v >= 100.0 {
        format!("{:.0} {}", v, units[i])
    } else {
        format!("{:.1} {}", v, units[i])
    }
}

/// Tooltip text for the current total speeds; plain name when nothing moves.
pub fn tooltip(down: u64, up: u64) -> String {
    if down == 0 && up == 0 {
        "Bunny Torrent".into()
    } else {
        format!("Bunny Torrent\nDown {}  Up {}", speed(down), speed(up))
    }
}

fn total_speeds(app: &App) -> (u64, u64) {
    app.session.with_torrents(|it| {
        it.fold((0, 0), |(d, u), (_, t)| {
            let s = t.stats();
            match (&s.state, &s.live) {
                (TorrentStatsState::Live, Some(l)) => {
                    (d + l.download_speed.as_bytes(), u + l.upload_speed.as_bytes())
                }
                _ => (d, u),
            }
        })
    })
}

pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        sync_idle_state(&w.as_ref().window());
    }
}

pub fn hide_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
        sync_idle_state(&w.as_ref().window());
    }
}

fn toggle_window(app: &AppHandle) {
    let shown = app
        .get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false));
    if shown {
        hide_window(app);
    } else {
        show_window(app);
    }
}

fn on_menu(app: &AppHandle, ev: MenuEvent) {
    match ev.id.as_ref() {
        "show" => show_window(app),
        "open" => {
            if let Some(st) = app.try_state::<App>() {
                crate::store::open_folder(None, st);
            }
        }
        "pause" | "resume" => {
            let (app, pause) = (app.clone(), ev.id.as_ref() == "pause");
            tauri::async_runtime::spawn(async move {
                let Some(st) = app.try_state::<App>() else { return };
                let ids: Vec<usize> = st
                    .session
                    .with_torrents(|it| it.filter(|(_, t)| t.is_paused() != pause).map(|(id, _)| id).collect());
                let _ = if pause {
                    torrents::pause_ids(&st, ids).await
                } else {
                    torrents::resume_ids(&st, ids).await
                };
            });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

pub fn init(app: &tauri::App) -> tauri::Result<()> {
    let h = app.handle();
    let menu = Menu::with_items(
        h,
        &[
            &MenuItem::with_id(h, "show", "Show Bunny Torrent", true, None::<&str>)?,
            &PredefinedMenuItem::separator(h)?,
            &MenuItem::with_id(h, "pause", "Pause all", true, None::<&str>)?,
            &MenuItem::with_id(h, "resume", "Resume all", true, None::<&str>)?,
            &MenuItem::with_id(h, "open", "Open downloads folder", true, None::<&str>)?,
            &PredefinedMenuItem::separator(h)?,
            &MenuItem::with_id(h, "quit", "Quit", true, None::<&str>)?,
        ],
    )?;
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Bunny Torrent")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    // Speed tooltip: one cheap check every 5 s, the OS call only when the text changed.
    let handle = h.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = String::from("Bunny Torrent");
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let Some(st) = handle.try_state::<App>() else { continue };
            let (d, u) = total_speeds(&st);
            let text = tooltip(d, u);
            if text != last {
                if let Some(t) = handle.tray_by_id(TRAY_ID) {
                    let _ = t.set_tooltip(Some(&text));
                }
                last = text;
            }
        }
    });
    Ok(())
}

/// Registers or removes the Windows startup entry. Release builds only, so a debug exe never
/// registers itself; failures are only logged.
pub fn sync_autostart(app: &AppHandle, on: bool) {
    if cfg!(debug_assertions) {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    let r = if on { al.enable() } else { al.disable() };
    if let Err(e) = r {
        dbg_log(&format!("autostart: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_formats_speeds() {
        assert_eq!(tooltip(0, 0), "Bunny Torrent");
        assert_eq!(tooltip(1536, 0), "Bunny Torrent\nDown 1.5 KB/s  Up 0 B/s");
        assert_eq!(tooltip(5 * 1024 * 1024, 300 * 1024), "Bunny Torrent\nDown 5.0 MB/s  Up 300 KB/s");
    }
}
