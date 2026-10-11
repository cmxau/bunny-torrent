//! Idle footprint: trim or suspend the embedded browser while the window is minimised.

use std::sync::atomic::{AtomicBool, Ordering};

use librqbit::TorrentStatsState;
use tauri::Manager;

use crate::store::{data_dir, now, App};

/// Debug-build breadcrumbs in <data dir>/debug.log (console output isn't visible when launched by a link click).
#[allow(unused_variables)]
pub fn dbg_log(msg: &str) {
    #[cfg(debug_assertions)]
    {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(data_dir().join("debug.log")) {
            let _ = writeln!(f, "{} {msg}", now());
        }
    }
}

pub static WEBVIEW_MINIMIZED: AtomicBool = AtomicBool::new(false);
pub static WEBVIEW_SUSPENDED: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
fn apply_webview_idle(wv: &tauri::webview::PlatformWebview, idle: bool, suspend: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, ICoreWebView2_3, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;
    unsafe {
        let controller = wv.controller();
        let Ok(core) = controller.CoreWebView2() else {
            return;
        };
        if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
            let _ = c19.SetMemoryUsageTargetLevel(if idle {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            });
        }
        if let Ok(c3) = core.cast::<ICoreWebView2_3>() {
            if idle {
                if suspend {
                    let _ = controller.SetIsVisible(false);
                    let done = webview2_com::TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(())));
                    let _ = c3.TrySuspend(&done);
                }
            } else {
                let _ = c3.Resume();
                let _ = controller.SetIsVisible(true);
            }
        }
    }
}

/// While the window is minimised nothing can be seen, so the embedded browser trims its memory and,
/// when nothing is downloading, suspends completely (like a background tab). Restoring undoes it.
pub fn sync_idle_state(window: &tauri::Window) {
    // A window hidden to the tray counts as minimised.
    let minimized = window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(true);
    let changed = WEBVIEW_MINIMIZED.swap(minimized, Ordering::SeqCst) != minimized;
    let must_resume = !minimized && WEBVIEW_SUSPENDED.load(Ordering::SeqCst);
    if !changed && !must_resume {
        return;
    }
    let app = window.app_handle().clone();
    let downloading = app
        .try_state::<App>()
        .map(|a| {
            a.session.with_torrents(|it| {
                let mut busy = false;
                for (_, t) in it {
                    let st = t.stats();
                    if matches!(st.state, TorrentStatsState::Live) && !st.finished {
                        busy = true;
                        break;
                    }
                }
                busy
            })
        })
        .unwrap_or(false);
    let suspend = minimized && !downloading;
    WEBVIEW_SUSPENDED.store(suspend, Ordering::SeqCst);
    dbg_log(&format!("idle: minimized={minimized} suspend={suspend}"));
    #[cfg(windows)]
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.with_webview(move |wv| apply_webview_idle(&wv, minimized, suspend));
    }
}
