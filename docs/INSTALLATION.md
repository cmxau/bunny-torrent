# Installation and setup

## For users

1. Download `Bunny Torrent_<version>_x64-setup.exe` from the [latest release](https://github.com/cmxau/bunny-torrent/releases/latest).
2. Run it. It installs per user, with no administrator prompt.
3. Magnet links and `.torrent` files are associated automatically. If another client owns them, choose Bunny Torrent under Windows Settings, Default apps.

Updates arrive on their own: the app checks GitHub at start-up and from About, then Check for updates. Updates are verified against a public key built into the app.

Requirements: Windows 10 or 11, 64-bit. The Microsoft WebView2 runtime is needed (already present on current Windows 11 and most Windows 10 installs; the installer fetches it if missing).

## Where your data lives

| What | Where |
| --- | --- |
| Settings, library, history | `%APPDATA%\BunnyTorrent\store.json` |
| Engine session files | `%APPDATA%\BunnyTorrent\` |
| Downloads | Folder chosen in Settings, General (default `Downloads\BunnyTorrent`) |

The store is saved every 10 minutes and on exit. Uninstalling does not delete it.

## For developers

### Prerequisites

- [Node.js](https://nodejs.org) 22 or newer
- [Rust](https://rustup.rs) (stable, MSVC toolchain)
- Visual Studio Build Tools with the "Desktop development with C++" workload
- WebView2 runtime

### Run it

```
npm install
npx tauri dev
```

The first Rust build takes several minutes; later ones are incremental. `npm run dev` alone starts only the web UI in a browser, where the Tauri commands are unavailable.

### Test and check

```
npx tsc --noEmit            # type-check the frontend
cd src-tauri
cargo test                  # backend tests (they use a real engine on temp folders)
```

### Build an installer

```
$env:TAURI_SIGNING_PRIVATE_KEY = "path\to\signing.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npx tauri build
```

The installer and its `.sig` file appear in `src-tauri/target/release/bundle/nsis/`. Without a signing key the build fails, because updater artifacts are enabled. To build without one, set `bundle.createUpdaterArtifacts` to `false` locally (do not commit that). See [RELEASING.md](RELEASING.md) for real releases.

### Disk space

`src-tauri/target` grows to many gigabytes. It is git-ignored and safe to delete with `cargo clean`.

### Notes

- Start with Windows writes to the registry, so it is only active in release builds. Debug builds never touch it.
- Debug builds share `%APPDATA%\BunnyTorrent` with the installed app. Back it up before experiments.
