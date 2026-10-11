<div align="center">

<img src="public/bunny.svg" width="96" alt="Bunny Torrent logo" />

# Bunny Torrent

A fast, light, good-looking BitTorrent client for Windows.

Built with Tauri 2, React and a Rust engine ([librqbit](https://github.com/ikatson/rqbit)).

</div>

## Features

**Downloading**
- Add by magnet link, `.torrent` file, or drag and drop onto the window.
- Clicking a `magnet:` link in a browser opens a preview popup: see the contents, choose which files to download and at what priority (normal, high, maximum, do not download), then add.
- Per-file priority and selection, changeable after the torrent has been added.
- Download queue with a limit on active downloads, reordering (move up, down, to top, to bottom) and force start.
- Seeding rules: stop or pause at a share ratio or a seeding time.
- Speed-limit schedule by day and time of day, plus global limits.
- Optional IP blocklist, loaded when the engine starts.

**Organising**
- Sidebar filters for status (downloading, seeding, completed, running, stopped, active, inactive, stalled, checking, moving, errored), categories, tags and trackers.
- Default categories for Video, Picture, Music and Other, each with its own download folder. New torrents are sorted into them by their content.
- Your own categories and tags.
- Selectable table columns (name, size, progress, status, seeds, peers, speeds, ETA, ratio, category, tags and more).
- Per-torrent details: general, trackers, peers, HTTP sources, contents and speed settings.

**Automation**
- Watch folders: drop a `.torrent` file in a folder and it is added automatically.
- RSS feeds with include/exclude/regex filters. A feed with no filters adds nothing, and the first check only records what is already there unless you opt in.
- Create your own `.torrent` from a file or folder and start seeding it.

**Overview and search**
- Overview page with summary cards, a speed chart and a hideable recent-torrents list.
- Search online sources (The Pirate Bay index and the Internet Archive) and add results directly. Past searches are kept as history.

**Living quietly on your PC**
- Tray icon with pause all / resume all / open downloads / quit. Closing the window hides it to the tray.
- Start with Windows, starting minimised to the tray.
- A "Download complete" notification, sent by the backend even while the window is hidden.
- Near-zero cost when idle: the embedded web view is suspended and trimmed when the window is minimised or hidden.
- Signed automatic updates from GitHub releases (About, then Check for updates).

## Install

Download `Bunny Torrent_<version>_x64-setup.exe` from the [latest release](https://github.com/cmxau/bunny-torrent/releases/latest) and run it. It installs for the current user and needs no administrator rights. Windows 10 and 11 (x64) are supported. See [docs/INSTALLATION.md](docs/INSTALLATION.md) for building from source.

## Documentation

| Document | What it covers |
| --- | --- |
| [Installation and setup](docs/INSTALLATION.md) | Installing, building from source, where your data lives |
| [Architecture](docs/ARCHITECTURE.md) | How the backend, frontend and scheduler fit together |
| [Contributing](docs/CONTRIBUTING.md) | Workflow, code style, tests, pull requests |
| [Releasing](docs/RELEASING.md) | Signing, tagging and publishing a release |
| [Changelog](CHANGELOG.md) | What changed in each version |

## Honest limits

Some things the underlying engine does not expose, so the app does not pretend to offer them: true seed and peer counts for the swarm, per-piece availability, per-torrent speed limits, tracker status and setting the private flag when creating a torrent. Online search sources are blocked on some managed networks (schools, workplaces); that is the network, not the app.

## Legal

Bunny Torrent is a general-purpose BitTorrent client. Only download and share content you have the right to. Terms and Privacy are in the About page.

## Licence

[MIT](LICENSE). Contributions are welcome; see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).
