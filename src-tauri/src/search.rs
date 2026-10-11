//! Online search: public index clients, result parsing, and search history.

use serde::Serialize;
use tauri::State;

use crate::store::App;

pub const PUBLIC_TRACKERS: [&str; 5] = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.moeking.me:6969/announce",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    id: String,
    source: &'static str,
    name: String,
    size: u64,
    /// -1 = the source doesn't say
    seeders: i64,
    leechers: i64,
    /// unix seconds, 0 = unknown
    added: u64,
    category: Option<String>,
    files: Option<u32>,
    /// what to hand to the add flow: a magnet link or a .torrent URL
    link: String,
}

#[derive(Serialize)]
pub struct SearchSourceError {
    source: String,
    message: String,
}

#[derive(Serialize)]
pub struct SearchResponse {
    results: Vec<SearchResult>,
    errors: Vec<SearchSourceError>,
}

pub fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

pub fn build_magnet(hash: &str, name: &str) -> String {
    let mut m = format!("magnet:?xt=urn:btih:{}&dn={}", hash.to_ascii_lowercase(), enc(name));
    for t in PUBLIC_TRACKERS {
        m.push_str("&tr=");
        m.push_str(&enc(t));
    }
    m
}

pub fn num_u64(v: &serde_json::Value) -> u64 {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        .unwrap_or(0)
}

pub fn num_i64(v: &serde_json::Value) -> i64 {
    v.as_i64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        .unwrap_or(0)
}

/// "2022-05-17T13:36:51Z" -> unix seconds (UTC); 0 if it doesn't parse.
pub fn iso_to_unix(s: &str) -> u64 {
    let p = |a: usize, b: usize| s.get(a..b).and_then(|x| x.parse::<i64>().ok());
    let (Some(y), Some(m), Some(d)) = (p(0, 4), p(5, 7), p(8, 10)) else {
        return 0;
    };
    let (h, mi, sec) = (p(11, 13).unwrap_or(0), p(14, 16).unwrap_or(0), p(17, 19).unwrap_or(0));
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    (days * 86400 + h * 3600 + mi * 60 + sec).max(0) as u64
}

pub fn parse_apibay(v: &serde_json::Value) -> Vec<SearchResult> {
    let Some(items) = v.as_array() else {
        return vec![];
    };
    items
        .iter()
        .filter_map(|it| {
            let hash = it["info_hash"].as_str()?.trim();
            // the API answers "no results" with a single all-zero placeholder row
            if hash.len() != 40 || hash.chars().all(|c| c == '0') {
                return None;
            }
            let name = it["name"].as_str()?.trim().to_string();
            Some(SearchResult {
                id: format!("apibay:{}", hash.to_ascii_lowercase()),
                source: "apibay",
                link: build_magnet(hash, &name),
                name,
                size: num_u64(&it["size"]),
                seeders: num_i64(&it["seeders"]),
                leechers: num_i64(&it["leechers"]),
                added: num_u64(&it["added"]),
                category: it["category"].as_str().map(str::to_string),
                files: Some(num_u64(&it["num_files"]) as u32).filter(|n| *n > 0),
            })
        })
        .collect()
}

pub fn parse_ia(v: &serde_json::Value) -> Vec<SearchResult> {
    let Some(docs) = v["response"]["docs"].as_array() else {
        return vec![];
    };
    docs.iter()
        .filter_map(|d| {
            let id = d["identifier"].as_str()?;
            let title = d["title"].as_str().unwrap_or(id).trim().to_string();
            Some(SearchResult {
                id: format!("internet-archive:{id}"),
                source: "internet-archive",
                link: format!("https://archive.org/download/{id}/{id}_archive.torrent"),
                name: title,
                size: num_u64(&d["item_size"]),
                seeders: -1,
                leechers: -1,
                added: d["publicdate"].as_str().map(iso_to_unix).unwrap_or(0),
                category: d["mediatype"].as_str().map(str::to_string),
                files: None,
            })
        })
        .collect()
}

/// A short human explanation for a failed request. The raw error names the whole URL and reads like noise.
/// The wording is shown after the source name, e.g. "Pirate Bay index: couldn't be reached. ...".
fn net_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "took too long to answer. Try again in a moment.".into()
    } else if e.is_connect() || e.is_request() {
        "couldn't be reached. Your network may be blocking this site, or you're offline.".into()
    } else if let Some(status) = e.status() {
        format!("answered with an error ({status}).")
    } else {
        "gave an answer the app couldn't read.".into()
    }
}

pub async fn search_apibay(c: &reqwest::Client, q: &str) -> Result<Vec<SearchResult>, String> {
    let v: serde_json::Value = c
        .get("https://apibay.org/q.php")
        .query(&[("q", q), ("cat", "0")])
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| net_error(&e))?
        .json()
        .await
        .map_err(|_| "gave an answer the app couldn't read.".to_string())?;
    Ok(parse_apibay(&v))
}

pub async fn search_ia(c: &reqwest::Client, q: &str) -> Result<Vec<SearchResult>, String> {
    let query = format!("({q}) AND format:(\"Archive BitTorrent\")");
    let v: serde_json::Value = c
        .get("https://archive.org/advancedsearch.php")
        .query(&[
            ("q", query.as_str()),
            ("fl[]", "identifier"),
            ("fl[]", "title"),
            ("fl[]", "item_size"),
            ("fl[]", "publicdate"),
            ("fl[]", "mediatype"),
            ("sort[]", "downloads desc"),
            ("rows", "40"),
            ("output", "json"),
        ])
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| net_error(&e))?
        .json()
        .await
        .map_err(|_| "gave an answer the app couldn't read.".to_string())?;
    Ok(parse_ia(&v))
}

#[tauri::command]
pub async fn search(app: State<'_, App>, query: String) -> Result<SearchResponse, String> {
    let q: String = query.trim().chars().take(200).collect();
    if q.is_empty() {
        return Err("Type something to search for.".into());
    }
    let enabled: Vec<String> = app.with_store(|s| {
        s.search_history.retain(|h| !h.eq_ignore_ascii_case(&q));
        s.search_history.insert(0, q.clone());
        s.search_history.truncate(30);
        s.settings.search_sources.clone()
    });
    if enabled.is_empty() {
        return Err("No search sources are turned on. Enable one in Settings → Search.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("BunnyTorrent/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let tasks: Vec<_> = enabled
        .into_iter()
        .map(|src| {
            let (c, q) = (client.clone(), q.clone());
            tokio::spawn(async move {
                let r = match src.as_str() {
                    "apibay" => search_apibay(&c, &q).await,
                    "internet-archive" => search_ia(&c, &q).await,
                    other => Err(format!("unknown source {other}")),
                };
                (src, r)
            })
        })
        .collect();
    let (mut results, mut errors) = (vec![], vec![]);
    for t in tasks {
        match t.await {
            Ok((_, Ok(v))) => results.extend(v),
            Ok((src, Err(message))) => errors.push(SearchSourceError { source: src, message }),
            Err(e) => errors.push(SearchSourceError { source: "?".into(), message: e.to_string() }),
        }
    }
    results.sort_by(|a, b| b.seeders.cmp(&a.seeders).then(b.added.cmp(&a.added)));
    Ok(SearchResponse { results, errors })
}

#[tauri::command]
pub fn remove_search_history(app: State<'_, App>, query: String) {
    app.with_store(|s| s.search_history.retain(|h| h != &query));
}

#[tauri::command]
pub fn clear_search_history(app: State<'_, App>) {
    app.with_store(|s| s.search_history.clear());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_unreachable_source_gets_a_plain_message() {
        // port 1 on localhost refuses connections, like a blocked site
        let c = reqwest::Client::builder().timeout(std::time::Duration::from_secs(5)).build().unwrap();
        let err = c.get("http://127.0.0.1:1/q.php").send().await.unwrap_err();
        let msg = net_error(&err);
        assert!(msg.contains("couldn't be reached"), "{msg}");
        assert!(!msg.contains("127.0.0.1"), "the URL should not leak into the message: {msg}");
    }

    #[test]
    fn iso_dates_become_unix_seconds() {
        assert_eq!(iso_to_unix("1970-01-02T00:00:00Z"), 86400);
        assert_eq!(iso_to_unix("2022-05-17T13:36:51Z"), 1652794611);
        assert_eq!(iso_to_unix("garbage"), 0);
    }

    #[test]
    fn apibay_rows_are_parsed_and_the_empty_placeholder_is_ignored() {
        let v: serde_json::Value = serde_json::from_str(
            r#"[{"id":"1","name":"Ubuntu 22.04 LTS","info_hash":"2C6B6858D61DA9543D4231A71DB4B1C9264B0685","leechers":"1","seeders":"31","size":"3654957056","num_files":"1","added":"1652877231","category":"303"}]"#,
        )
        .unwrap();
        let r = parse_apibay(&v);
        assert_eq!(r.len(), 1);
        assert_eq!((r[0].seeders, r[0].leechers, r[0].size), (31, 1, 3654957056));
        assert!(r[0].link.starts_with("magnet:?xt=urn:btih:2c6b6858d61da9543d4231a71db4b1c9264b0685&dn=Ubuntu+22.04+LTS&tr="));
        let none: serde_json::Value = serde_json::from_str(
            r#"[{"id":"0","name":"No results returned","info_hash":"0000000000000000000000000000000000000000"}]"#,
        )
        .unwrap();
        assert!(parse_apibay(&none).is_empty());
    }

    #[test]
    fn internet_archive_docs_become_torrent_urls() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"response":{"docs":[{"identifier":"some-item","item_size":651771924,"publicdate":"2022-05-17T13:36:51Z","title":"A Title","mediatype":"movies"}]}}"#,
        )
        .unwrap();
        let r = parse_ia(&v);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].link, "https://archive.org/download/some-item/some-item_archive.torrent");
        assert_eq!((r[0].seeders, r[0].size, r[0].added), (-1, 651771924, 1652794611));
    }

    /// Hits the real public APIs; run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_search_sources_answer() {
        let c = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent("BunnyTorrent/0.1")
            .build()
            .unwrap();
        let a = search_apibay(&c, "ubuntu").await.unwrap();
        assert!(!a.is_empty(), "apibay returned nothing");
        assert!(a[0].link.starts_with("magnet:?xt=urn:btih:"));
        let b = search_ia(&c, "ubuntu").await.unwrap();
        assert!(!b.is_empty(), "internet archive returned nothing");
        assert!(b[0].link.ends_with("_archive.torrent"));
        println!("apibay: {} results, first: {} ({} seeders)", a.len(), a[0].name, a[0].seeders);
        println!("internet archive: {} results, first: {}", b.len(), b[0].name);
    }
}
