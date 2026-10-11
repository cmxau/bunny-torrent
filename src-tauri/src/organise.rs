//! Categories, tags and the global tracker list.

use tauri::State;

use crate::{
    store::{App, Category},
    torrents::handle,
};

pub fn hashes(app: &App, ids: &[usize]) -> Vec<String> {
    ids.iter()
        .filter_map(|id| handle(app, *id).ok())
        .map(|h| h.info_hash().as_string())
        .collect()
}

#[tauri::command]
pub fn set_category(app: State<'_, App>, ids: Vec<usize>, category: Option<String>) {
    let hs = hashes(&app, &ids);
    app.with_store(|s| {
        for h in hs {
            s.torrents.entry(h).or_default().category = category.clone();
        }
    });
}

#[tauri::command]
pub fn set_tags(app: State<'_, App>, ids: Vec<usize>, tags: Vec<String>) {
    let hs = hashes(&app, &ids);
    app.with_store(|s| {
        for h in hs {
            s.torrents.entry(h).or_default().tags = tags.clone();
        }
    });
}

#[tauri::command]
pub fn create_category(app: State<'_, App>, name: String, save_path: Option<String>) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("name is empty".into());
    }
    app.with_store(|s| {
        if s.categories.iter().any(|c| c.name.eq_ignore_ascii_case(&name)) {
            return Err("category already exists".to_string());
        }
        s.categories.push(Category {
            name,
            save_path: save_path.filter(|p| !p.trim().is_empty()),
        });
        Ok(())
    })
}

#[tauri::command]
pub fn delete_category(app: State<'_, App>, name: String) {
    app.with_store(|s| {
        s.categories.retain(|c| c.name != name);
        for m in s.torrents.values_mut() {
            if m.category.as_deref() == Some(&name) {
                m.category = None;
            }
        }
    });
}

#[tauri::command]
pub fn create_tag(app: State<'_, App>, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("name is empty".into());
    }
    app.with_store(|s| {
        if s.tags.iter().any(|t| t.eq_ignore_ascii_case(&name)) {
            return Err("tag already exists".to_string());
        }
        s.tags.push(name);
        Ok(())
    })
}

#[tauri::command]
pub fn delete_tag(app: State<'_, App>, name: String) {
    app.with_store(|s| {
        s.tags.retain(|t| t != &name);
        for m in s.torrents.values_mut() {
            m.tags.retain(|t| t != &name);
        }
    });
}

#[tauri::command]
pub fn add_tracker_list(app: State<'_, App>, urls: Vec<String>) -> Result<u32, String> {
    let mut n = 0;
    let mut bad = None;
    app.with_store(|s| {
        for u in urls.iter().map(|u| u.trim()).filter(|u| !u.is_empty()) {
            if url_ok(u) {
                if !s.tracker_list.iter().any(|x| x == u) {
                    s.tracker_list.push(u.to_string());
                    n += 1;
                }
            } else {
                bad = Some(u.to_string());
            }
        }
    });
    match bad {
        Some(b) if n == 0 => Err(format!("not a valid tracker URL: {b}")),
        _ => Ok(n),
    }
}

fn url_ok(u: &str) -> bool {
    ["http://", "https://", "udp://"].iter().any(|p| u.starts_with(p)) && u.len() > 9
}

#[tauri::command]
pub fn remove_tracker_list(app: State<'_, App>, url: String) {
    app.with_store(|s| s.tracker_list.retain(|u| u != &url));
}
