#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod add;
mod create;
mod feeds;
mod idle;
mod links;
mod notify;
mod organise;
mod priorities;
mod queue;
mod schedule;
mod search;
mod seeding;
mod store;
mod torrents;
mod tray;
mod watch;

use std::{
    collections::{HashMap, HashSet},
    num::NonZeroU32,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use librqbit::{
    limits::LimitsConfig, DhtSessionConfig, ListenerMode, ListenerOptions, ManagedTorrent, Session,
    SessionOptions, SessionPersistenceConfig,
};
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

use idle::{dbg_log, sync_idle_state};
use links::{parse_args, push_incoming};
use priorities::apply_priorities;
use store::{data_dir, save_store, App, Settings, Store};

/// Starts the torrent engine from the saved settings, falling back to a random port if the
/// configured one is taken.
fn start_session(
    rt: &tokio::runtime::Handle,
    st: &Settings,
    dir: &std::path::Path,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let build_opts = |port: u16, blocklist: bool| SessionOptions {
        blocklist_url: (blocklist && !st.blocklist_url.is_empty()).then(|| st.blocklist_url.clone()),
        fastresume: true,
        persistence: Some(SessionPersistenceConfig::Json {
            folder: Some(dir.join("session")),
        }),
        dht: st.dht.then(DhtSessionConfig::default),
        listen: Some(ListenerOptions {
            mode: ListenerMode::TcpAndUtp,
            listen_addr: ([0, 0, 0, 0, 0, 0, 0, 0], port).into(),
            enable_upnp_port_forwarding: st.upnp,
            ..Default::default()
        }),
        peer_limit: (st.peer_limit > 0).then_some(st.peer_limit as usize),
        ratelimits: LimitsConfig {
            download_bps: NonZeroU32::new(st.dl_limit_kib.saturating_mul(1024)),
            upload_bps: NonZeroU32::new(st.ul_limit_kib.saturating_mul(1024)),
        },
        ..Default::default()
    };
    let download_dir = PathBuf::from(&st.download_dir);
    let start = |port: u16, bl: bool| rt.block_on(Session::new_with_opts(download_dir.clone(), build_opts(port, bl)));
    // A blocklist that cannot be downloaded must not keep the app from starting.
    Ok(start(st.listen_port, true)
        .or_else(|_| start(0, true))
        .or_else(|_| start(st.listen_port, false))
        .or_else(|_| start(0, false))?)
}

/// Counts active time and re-evaluates staged file priorities as files finish.
/// Only cheap checks; it slows to every 10 s when nothing is running, and saves the library
/// file every 10 minutes (changes you make are saved immediately, and everything on quit).
fn spawn_scheduler(
    rt: &tokio::runtime::Handle,
    session: Arc<Session>,
    store: Arc<Mutex<Store>>,
    path: PathBuf,
    app: tauri::AppHandle,
) {
    rt.spawn(async move {
        let (mut step, mut since_save) = (2u64, 0u64);
        let mut finished_seen: HashSet<String> = HashSet::new();
        let mut first = true;
        let mut limits = None;
        loop {
            tokio::time::sleep(Duration::from_secs(step)).await;
            since_save += step;
            let torrents: Vec<Arc<ManagedTorrent>> =
                session.with_torrents(|it| it.map(|(_, t)| t.clone()).collect());
            let current: Vec<(String, String, bool)> = torrents
                .iter()
                .map(|t| (t.info_hash().as_string(), t.name().unwrap_or_default(), t.stats().finished))
                .collect();
            let done = notify::newly_finished(&mut finished_seen, &current, first);
            first = false;
            if !done.is_empty() && store.lock().unwrap().settings.notify_on_complete {
                for name in &done {
                    notify::show_complete(&app, name);
                }
            }
            let mut running = 0usize;
            let mut work: Vec<(Arc<ManagedTorrent>, HashMap<usize, u8>)> = vec![];
            {
                let mut g = store.lock().unwrap();
                for t in &torrents {
                    let live = !t.is_paused();
                    if live {
                        running += 1;
                    }
                    if let Some(m) = g.torrents.get_mut(&t.info_hash().as_string()) {
                        if live {
                            m.active_secs += step;
                        }
                        if m.file_prio.values().any(|p| *p != 1) {
                            work.push((t.clone(), m.file_prio.clone()));
                        }
                    }
                }
                if since_save >= 600 {
                    save_store(&path, &g);
                    since_save = 0;
                }
            }
            for (t, p) in &work {
                let _ = apply_priorities(&session, t, p).await;
            }
            let mut dirty = seeding::tick(&session, &store).await;
            dirty |= queue::tick(&session, &store).await;
            let eff = schedule::current_limits(&store.lock().unwrap().settings);
            if limits != Some(eff) {
                schedule::apply(&session, eff);
                limits = Some(eff);
            }
            if dirty {
                save_store(&path, &store.lock().unwrap());
            }
            step = if running > 0 || !work.is_empty() { 2 } else { 10 };
        }
    });
}

/// Fit the window to this screen (the config size is only a ceiling) and centre it.
fn fit_window(app: &tauri::App) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    if let Ok(Some(m)) = w.current_monitor().or_else(|_| w.primary_monitor()) {
        let scale = m.scale_factor();
        let (mw, mh) = (m.size().width as f64 / scale, m.size().height as f64 / scale);
        let width = (mw * 0.92).clamp(940.0, 1180.0);
        let height = (mh * 0.86).clamp(520.0, 760.0);
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
        let _ = w.center();
    }
}

fn setup(app: &mut tauri::App, rt: &tokio::runtime::Handle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).ok();
    let store_path = dir.join("store.json");
    let store: Store = std::fs::read(&store_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let st = store.settings.clone();
    std::fs::create_dir_all(&st.download_dir).ok();
    dbg_log(&format!("setup; startup args={:?}", std::env::args().collect::<Vec<_>>()));

    let session = start_session(rt, &st, &dir)?;
    let store = Arc::new(Mutex::new(store));
    spawn_scheduler(rt, session.clone(), store.clone(), store_path.clone(), app.handle().clone());
    fit_window(app);
    if let Err(e) = tray::init(app) {
        dbg_log(&format!("tray: {e}"));
    }
    if std::env::args().any(|a| a == "--minimized") {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
    tray::sync_autostart(app.handle(), st.start_with_windows);
    if st.handle_magnets {
        let _ = app.deep_link().register("magnet");
    }
    app.manage(App {
        session,
        store,
        store_path,
        startup: st,
        kinds: Mutex::new(HashMap::new()),
        previews: Mutex::new(HashMap::new()),
        incoming: Mutex::new(parse_args(&std::env::args().skip(1).collect::<Vec<_>>())),
    });
    feeds::spawn(rt, app.handle().clone());
    watch::spawn(rt, app.handle().clone());
    Ok(())
}

fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let rt_handle = rt.handle().clone();
    tauri::async_runtime::set(rt_handle.clone());

    tauri::Builder::default()
        // Must be first. A second launch (for example another magnet click) hands its arguments to
        // the running instance and exits here, before it touches the engine's session files.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            dbg_log(&format!("single-instance callback argv={argv:?}"));
            push_incoming(app, parse_args(&argv[argv.len().min(1)..]));
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| setup(app, &rt_handle))
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_) => sync_idle_state(window),
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let to_tray = window
                        .try_state::<App>()
                        .is_none_or(|a| a.store.lock().unwrap().settings.close_to_tray);
                    if to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                        sync_idle_state(window);
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            torrents::snapshot,
            torrents::details,
            priorities::set_file_priority,
            add::add,
            torrents::pause,
            torrents::resume,
            torrents::remove,
            queue::queue_move,
            organise::set_category,
            organise::set_tags,
            organise::create_category,
            organise::delete_category,
            organise::create_tag,
            organise::delete_tag,
            organise::add_tracker_list,
            organise::remove_tracker_list,
            store::save_settings,
            links::take_incoming,
            add::preview,
            add::drop_preview,
            add::add_previewed,
            links::default_handler_status,
            search::search,
            search::remove_search_history,
            search::clear_search_history,
            store::open_folder,
            create::create_torrent,
            feeds::feed_check_now,
            feeds::feed_test
        ])
        .build(tauri::generate_context!())
        .expect("tauri")
        .run(|handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(st) = handle.try_state::<App>() {
                    save_store(&st.store_path, &st.store.lock().unwrap());
                }
            }
        });
    drop(rt);
}
