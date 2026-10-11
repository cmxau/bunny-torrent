//! RSS/Atom feeds: fetch, pick torrent links, match against your rules and add what is new.

use std::{collections::HashSet, time::Duration};

use regex::RegexBuilder;
use serde::Serialize;
use tauri::{Manager, State};

use crate::{
    add::{add_core, AddReq},
    store::{now, AddedItem, App, Feed, FeedFilter, FeedState},
};

const MAX_ADDS_PER_CHECK: usize = 20;
const MAX_SEEN: usize = 500;
const MAX_RECENT: usize = 20;

pub struct Item {
    pub id: String,
    pub title: String,
    pub link: Option<String>,
    /// magnet link or .torrent URL to add
    pub source: Option<String>,
}

// ---------------------------------------------------------------- matching

fn regex_for(pattern: &str) -> Result<regex::Regex, regex::Error> {
    RegexBuilder::new(pattern).case_insensitive(true).build()
}

pub fn filter_matches(f: &FeedFilter, title: &str) -> bool {
    if f.regex {
        let Ok(inc) = regex_for(&f.include) else { return false };
        if !inc.is_match(title) {
            return false;
        }
        if f.exclude.trim().is_empty() {
            return true;
        }
        return match regex_for(&f.exclude) {
            Ok(ex) => !ex.is_match(title),
            Err(_) => false,
        };
    }
    let t = title.to_lowercase();
    f.include.split_whitespace().all(|w| t.contains(&w.to_lowercase()))
        && !f.exclude.split_whitespace().any(|w| t.contains(&w.to_lowercase()))
}

/// At least one enabled filter must match; with none enabled nothing matches.
pub fn feed_matches(filters: &[FeedFilter], title: &str) -> bool {
    filters.iter().any(|f| f.enabled && filter_matches(f, title))
}

pub fn filter_errors(filters: &[FeedFilter]) -> Vec<String> {
    let mut out = vec![];
    for (i, f) in filters.iter().enumerate() {
        if !f.regex {
            continue;
        }
        if let Err(e) = regex_for(&f.include) {
            out.push(format!("Rule {}: include pattern is not valid ({e})", i + 1));
        }
        if !f.exclude.trim().is_empty() {
            if let Err(e) = regex_for(&f.exclude) {
                out.push(format!("Rule {}: exclude pattern is not valid ({e})", i + 1));
            }
        }
    }
    out
}

// ---------------------------------------------------------------- parsing

fn is_torrent_url(url: &str, mime: Option<&str>) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_lowercase();
    path.ends_with(".torrent") || mime.is_some_and(|m| m.eq_ignore_ascii_case("application/x-bittorrent"))
}

/// First magnet link, else first .torrent URL, among the candidate (url, mime) pairs.
pub fn pick_source(cands: &[(String, Option<String>)]) -> Option<String> {
    cands
        .iter()
        .find(|(u, _)| u.trim_start().to_lowercase().starts_with("magnet:"))
        .or_else(|| cands.iter().find(|(u, m)| is_torrent_url(u, m.as_deref())))
        .map(|(u, _)| u.trim().to_string())
}

pub fn parse_items(bytes: &[u8]) -> Result<(String, Vec<Item>), String> {
    let feed = feed_rs::parser::parse(bytes).map_err(|e| format!("Couldn't read this feed: {e}"))?;
    let title = feed.title.map(|t| t.content).unwrap_or_default();
    let items = feed
        .entries
        .into_iter()
        .map(|e| {
            let mut cands: Vec<(String, Option<String>)> =
                e.links.iter().map(|l| (l.href.clone(), l.media_type.clone())).collect();
            for m in &e.media {
                for c in &m.content {
                    if let Some(u) = &c.url {
                        cands.push((u.to_string(), c.content_type.as_ref().map(|t| t.to_string())));
                    }
                }
            }
            let link = e.links.first().map(|l| l.href.clone());
            let title = e.title.map(|t| t.content.trim().to_string()).unwrap_or_default();
            let id = [Some(e.id.as_str()), link.as_deref(), Some(title.as_str())]
                .into_iter()
                .flatten()
                .find(|s| !s.is_empty())
                .unwrap_or_default()
                .to_string();
            Item { id, title, link, source: pick_source(&cands) }
        })
        .collect();
    Ok((title, items))
}

async fn fetch(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("BunnyTorrent/0.1")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let r = client.get(url).send().await.map_err(|e| format!("Couldn't reach the feed: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("The feed answered with HTTP {}", r.status().as_u16()));
    }
    Ok(r.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

// ---------------------------------------------------------------- decisions

pub struct Plan {
    /// indices into the items to add now
    pub to_add: Vec<usize>,
    /// seen list after this check (before trimming), items deferred by the cap excluded
    pub seen: Vec<String>,
    /// items matching the rules that carry a torrent source
    pub matched: u32,
}

/// What to do with the current items. A never-checked feed without `add_existing` only records them.
pub fn plan_check(feed: &Feed, state: &FeedState, items: &[Item]) -> Plan {
    let seen: HashSet<&str> = state.seen.iter().map(String::as_str).collect();
    let first_quiet = state.last_checked == 0 && !feed.add_existing;
    let matched = items.iter().filter(|i| i.source.is_some() && feed_matches(&feed.filters, &i.title)).count() as u32;
    let mut to_add = vec![];
    let mut deferred: HashSet<&str> = HashSet::new();
    if !first_quiet {
        for (n, i) in items.iter().enumerate() {
            if i.source.is_none() || seen.contains(i.id.as_str()) || !feed_matches(&feed.filters, &i.title) {
                continue;
            }
            if to_add.len() < MAX_ADDS_PER_CHECK {
                to_add.push(n);
            } else {
                deferred.insert(i.id.as_str());
            }
        }
    }
    let mut next = state.seen.clone();
    for i in items {
        if !deferred.contains(i.id.as_str()) && !seen.contains(i.id.as_str()) {
            next.push(i.id.clone());
        }
    }
    Plan { to_add, seen: next, matched }
}

/// Keeps the newest `max` entries (the list is oldest first).
pub fn trim_seen(mut seen: Vec<String>, max: usize) -> Vec<String> {
    if seen.len() > max {
        seen.drain(..seen.len() - max);
    }
    seen
}

pub fn is_due(feed: &Feed, state: Option<&FeedState>, at: u64) -> bool {
    let last = state.map_or(0, |s| s.last_checked);
    feed.enabled && at.saturating_sub(last) >= u64::from(feed.interval_mins.max(5)) * 60
}

// ---------------------------------------------------------------- running

#[derive(Serialize)]
pub struct FeedCheckResult {
    pub fetched: u32,
    pub matched: u32,
    pub added: u32,
}

async fn run_feed(app: &App, feed: &Feed) -> Result<FeedCheckResult, String> {
    let fetched = async {
        let bytes = fetch(&feed.url).await?;
        parse_items(&bytes).map(|(_, items)| items)
    }
    .await;
    let items = match fetched {
        Ok(i) => i,
        Err(e) => {
            app.with_store(|s| {
                let st = s.feed_state.entry(feed.id.clone()).or_default();
                st.last_checked = now();
                st.last_error = Some(e.clone());
            });
            return Err(e);
        }
    };
    let state = app.store.lock().unwrap().feed_state.get(&feed.id).cloned().unwrap_or_default();
    let plan = plan_check(feed, &state, &items);
    let (mut added_items, mut failed, mut last_err): (Vec<AddedItem>, HashSet<String>, Option<String>) =
        (vec![], HashSet::new(), None);
    for &n in &plan.to_add {
        let item = &items[n];
        let req = AddReq {
            magnet: item.source.clone(),
            category: feed.category.clone(),
            paused: feed.paused.then_some(true),
            ..Default::default()
        };
        match add_core(app, req).await {
            Ok(r) if r.added > 0 => added_items.push(AddedItem { title: item.title.clone(), at: now() }),
            Ok(_) => {} // already in the list
            Err(e) => {
                last_err = Some(format!("{}: {e}", item.title));
                failed.insert(item.id.clone()); // stays unseen, tried again next time
            }
        }
    }
    let added = added_items.len() as u32;
    app.with_store(|s| {
        let st = s.feed_state.entry(feed.id.clone()).or_default();
        st.last_checked = now();
        st.last_error = last_err;
        st.seen = trim_seen(plan.seen.into_iter().filter(|i| !failed.contains(i)).collect(), MAX_SEEN);
        st.added_total += added;
        added_items.reverse();
        added_items.extend(std::mem::take(&mut st.recent));
        added_items.truncate(MAX_RECENT);
        st.recent = added_items;
    });
    Ok(FeedCheckResult { fetched: items.len() as u32, matched: plan.matched, added })
}

#[tauri::command]
pub async fn feed_check_now(app: State<'_, App>, id: String) -> Result<FeedCheckResult, String> {
    let feed = app
        .store
        .lock()
        .unwrap()
        .settings
        .feeds
        .iter()
        .find(|f| f.id == id)
        .cloned()
        .ok_or_else(|| "That feed no longer exists.".to_string())?;
    run_feed(&app, &feed).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedTestItem {
    pub title: String,
    pub link: Option<String>,
    pub matches: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedTest {
    pub title: String,
    pub items: Vec<FeedTestItem>,
    pub filter_errors: Vec<String>,
}

#[tauri::command]
pub async fn feed_test(url: String, filters: Vec<FeedFilter>) -> Result<FeedTest, String> {
    let (title, items) = parse_items(&fetch(url.trim()).await?)?;
    Ok(FeedTest {
        title,
        filter_errors: filter_errors(&filters),
        items: items
            .into_iter()
            .take(30)
            .map(|i| FeedTestItem {
                matches: feed_matches(&filters, &i.title),
                link: i.source.or(i.link),
                title: i.title,
            })
            .collect(),
    })
}

/// Wakes every minute and checks the feeds whose interval has passed, one at a time.
pub fn spawn(rt: &tokio::runtime::Handle, handle: tauri::AppHandle) {
    rt.spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let Some(app) = handle.try_state::<App>() else { continue };
            let due: Vec<Feed> = {
                let s = app.store.lock().unwrap();
                let t = now();
                s.settings
                    .feeds
                    .iter()
                    .filter(|f| is_due(f, s.feed_state.get(&f.id), t))
                    .cloned()
                    .collect()
            };
            for f in &due {
                let _ = run_feed(&app, f).await; // a failing feed records its error and the rest go on
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flt(include: &str, exclude: &str, regex: bool) -> FeedFilter {
        FeedFilter { include: include.into(), exclude: exclude.into(), regex, enabled: true }
    }

    fn item(id: &str, title: &str, src: bool) -> Item {
        Item { id: id.into(), title: title.into(), link: None, source: src.then(|| format!("magnet:?xt=urn:btih:{id}")) }
    }

    fn feed(add_existing: bool) -> Feed {
        Feed { id: "f".into(), enabled: true, add_existing, filters: vec![flt("", "", false)], ..Default::default() }
    }

    #[test]
    fn plain_filters_need_every_include_token_and_no_exclude_token() {
        let f = flt("ubuntu 24", "beta", false);
        assert!(filter_matches(&f, "Ubuntu Desktop 24.04 amd64"));
        assert!(!filter_matches(&f, "Ubuntu 22.04"));
        assert!(!filter_matches(&f, "Ubuntu 24.04 BETA"));
        assert!(filter_matches(&flt("", "", false), "anything"));
    }

    #[test]
    fn regex_filters_include_exclude_and_invalid() {
        let f = flt(r"s\d+e\d+", "720p", true);
        assert!(filter_matches(&f, "Show S01E02 1080p"));
        assert!(!filter_matches(&f, "Show S01E02 720P"));
        assert!(!filter_matches(&f, "Show special"));
        assert!(!filter_matches(&flt("(", "", true), "x"));
        assert!(!filter_matches(&flt("x", "(", true), "x"));
        assert_eq!(filter_errors(&[flt("(", "[", true), flt("(", "", false)]).len(), 2);
    }

    #[test]
    fn any_enabled_filter_may_match_and_none_means_nothing() {
        assert!(!feed_matches(&[], "x"));
        let mut off = flt("", "", false);
        off.enabled = false;
        assert!(!feed_matches(&[off.clone()], "x"));
        assert!(feed_matches(&[off, flt("zzz", "", false), flt("x", "", false)], "x"));
    }

    #[test]
    fn rss_magnet_and_enclosure_and_nyaa_style_links() {
        let rss = r#"<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title>Magnet one</title><guid>g1</guid><link>magnet:?xt=urn:btih:aaaa</link></item>
<item><title>Enclosure two</title><guid>g2</guid><link>https://site/view/2</link><enclosure url="https://site/dl/2.torrent" type="application/x-bittorrent" length="1"/></item>
<item><title>Nyaa three</title><guid isPermaLink="true">https://nyaa.si/view/3</guid><link>https://nyaa.si/download/3.torrent</link></item>
<item><title>No torrent</title><guid>g4</guid><link>https://site/view/4</link></item>
<item><title>Mime only</title><guid>g5</guid><enclosure url="https://site/get?id=5" type="application/x-bittorrent" length="1"/></item>
</channel></rss>"#;
        let (title, items) = parse_items(rss.as_bytes()).unwrap();
        assert_eq!(title, "T");
        assert_eq!(items.len(), 5);
        assert_eq!(items[0].source.as_deref(), Some("magnet:?xt=urn:btih:aaaa"));
        assert_eq!(items[1].source.as_deref(), Some("https://site/dl/2.torrent"));
        assert_eq!(items[2].source.as_deref(), Some("https://nyaa.si/download/3.torrent"));
        assert_eq!(items[2].id, "https://nyaa.si/view/3");
        assert_eq!(items[3].source, None);
        assert_eq!(items[4].source.as_deref(), Some("https://site/get?id=5"));
        assert_eq!(items[1].id, "g2");
    }

    #[test]
    fn atom_magnet_link_beats_torrent_link() {
        let atom = r#"<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><updated>2024-01-01T00:00:00Z</updated>
<entry><title>One</title><id>urn:1</id><updated>2024-01-01T00:00:00Z</updated>
<link href="https://x/1.torrent" type="application/x-bittorrent"/><link rel="alternate" href="magnet:?xt=urn:btih:bbbb"/></entry></feed>"#;
        let (_, items) = parse_items(atom.as_bytes()).unwrap();
        assert_eq!(items[0].source.as_deref(), Some("magnet:?xt=urn:btih:bbbb"));
        assert!(parse_items(b"not a feed").is_err());
    }

    #[test]
    fn first_check_only_records_unless_add_existing() {
        let items = vec![item("a", "A", true), item("b", "B", true)];
        let p = plan_check(&feed(false), &FeedState::default(), &items);
        assert!(p.to_add.is_empty());
        assert_eq!(p.seen, vec!["a", "b"]);
        let p = plan_check(&feed(true), &FeedState::default(), &items);
        assert_eq!(p.to_add, vec![0, 1]);
    }

    #[test]
    fn later_checks_add_only_unseen_matching_items_with_a_source() {
        let st = FeedState { last_checked: 5, seen: vec!["a".into()], ..Default::default() };
        let items = vec![item("a", "A", true), item("b", "B", true), item("c", "C", false)];
        let p = plan_check(&feed(false), &st, &items);
        assert_eq!(p.to_add, vec![1]);
        assert_eq!(p.seen, vec!["a", "b", "c"]);
        let mut no_rules = feed(false);
        no_rules.filters.clear();
        assert!(plan_check(&no_rules, &st, &items).to_add.is_empty());
    }

    #[test]
    fn at_most_twenty_adds_and_the_rest_stay_unseen() {
        let items: Vec<Item> = (0..25).map(|n| item(&format!("i{n}"), "T", true)).collect();
        let st = FeedState { last_checked: 5, ..Default::default() };
        let p = plan_check(&feed(false), &st, &items);
        assert_eq!(p.to_add.len(), 20);
        assert_eq!(p.seen.len(), 20);
        assert!(!p.seen.contains(&"i20".to_string()));
    }

    #[test]
    fn seen_list_keeps_the_newest() {
        let v: Vec<String> = (0..600).map(|n| n.to_string()).collect();
        let t = trim_seen(v, 500);
        assert_eq!(t.len(), 500);
        assert_eq!(t[0], "100");
        assert_eq!(t[499], "599");
    }

    #[test]
    fn due_respects_interval_minimum_and_enabled() {
        let mut f = feed(false);
        f.interval_mins = 1; // clamped to 5
        let st = FeedState { last_checked: 1000, ..Default::default() };
        assert!(!is_due(&f, Some(&st), 1000 + 299));
        assert!(is_due(&f, Some(&st), 1000 + 300));
        assert!(is_due(&f, None, 1000));
        f.enabled = false;
        assert!(!is_due(&f, None, 100_000));
    }
}
