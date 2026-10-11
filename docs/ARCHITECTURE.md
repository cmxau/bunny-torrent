# Architecture

Bunny Torrent is a Tauri 2 app: a Rust process owns the BitTorrent engine and all state, and a React web view is only a display and control surface.

```
React UI (WebView2)  <-- invoke / events -->  Rust backend  -->  librqbit session  -->  network, disk
   src/                                          src-tauri/src/
```

## Why Tauri

Tauri uses the system WebView2 instead of bundling Chromium, so the installer is about 5 MB and the idle footprint is small. The heavy work (hashing, networking, disk) happens in Rust with no JavaScript in the data path, so UI choices never slow transfers.

## Backend (`src-tauri/src`)

| Module | Responsibility |
| --- | --- |
| `main.rs` | Builder, plugins, `setup`, engine start, the scheduler loop, command registration |
| `store.rs` | `Settings`, per-torrent `Meta`, `Store` (persisted JSON), shared `App` state |
| `torrents.rs` | Turns engine state into `TorrentInfo` and the polled `Snapshot`; per-torrent details; pause and resume |
| `add.rs` | Adding from magnet, file or bytes; preview (list-only resolve) then add; target folder choice |
| `organise.rs` | Content-kind detection (video, picture, music, other) and category folders |
| `priorities.rs` | Per-file priority, emulated in tiers because the engine has only select / skip |
| `queue.rs` | Active-download limit, ordering, force start |
| `seeding.rs` | Ratio and time limits and the action taken |
| `schedule.rs` | Time-of-day speed limits applied at runtime |
| `watch.rs` | Watch folders (scan every 15 s while any is enabled) |
| `feeds.rs` | RSS polling, filter matching, de-duplication |
| `create.rs` | Building a `.torrent` and optionally seeding it |
| `search.rs` | Online search sources, with plain-language network errors |
| `links.rs` | `magnet:` and `.torrent` hand-off, including from a second launch |
| `tray.rs` | Tray icon and menu, close-to-tray, start with Windows |
| `notify.rs` | "Download complete" notifications from the backend |
| `idle.rs` | Suspends and trims the web view when minimised or hidden |

### Scheduler

One loop in `main.rs` runs every 2 seconds (every 10 when nothing is active). Each tick it counts active time, applies priority tiers, enforces the queue, seeding rules and the speed schedule, and fires completion notifications. `store.json` is written every 10 minutes and on exit, not on every tick, to keep disk writes near zero.

### Single instance and links

The single-instance plugin is registered first. A second launch (for example clicking a magnet link) forwards its arguments to the running copy and exits. The engine session is created inside `setup`, after that plugin, so two processes never fight over session files.

## Frontend (`src`)

- `App.tsx` owns the selection, active view and dialogs. Views: `Overview`, torrent table (`TorrentTable`, `ListHead`, `StatsPanel`), `Details`, `Settings` (with `AutomationTab`), `About`.
- `api.ts` is the single typed wrapper around Tauri commands; the TypeScript types mirror the Rust structs (camelCase).
- `usePolling` fetches the snapshot once a second while visible and every 5 seconds while hidden. Snapshots are JSON-compared so unchanged data causes no re-render. Chart history lives in a ref, not state.
- `filters.ts` and `columns.tsx` define sidebar filters and selectable columns. `sidebarItems.ts` and `useHiddenItems.ts` let users hide sidebar entries.
- `updater.ts` wraps the signed update check; `legal.ts` holds the Terms and Privacy text.

## Engine limits

librqbit does not expose real swarm seed counts, per-piece availability, web seeds, per-torrent speed limits, native per-file priority, tracker status, or setting the private flag. The app either emulates the feature (priority tiers) or leaves it out rather than show invented numbers.

## Updates and release

`tauri-plugin-updater` reads `latest.json` from the latest GitHub release and installs only packages signed with the private key matching the public key in `tauri.conf.json`. The Release workflow builds, signs and publishes on a version tag. See [RELEASING.md](RELEASING.md).

## Performance rules

- No per-tick disk writes; no polling faster than once a second.
- Hidden or minimised means the web view is suspended and memory trimmed.
- Nothing in the UI blocks the engine; commands read engine state and return.
- Measured on a release build with an empty library: minimised about 0.04% CPU and 55 MB; hidden to tray about 0.01% CPU and 68 MB.
