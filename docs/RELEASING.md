# Releasing Bunny Torrent

The in-app updater (About → Check for updates) reads
`https://github.com/cmxau/bunny-torrent/releases/latest/download/latest.json`
and only installs packages signed with your private key.

## One-time setup

1. The signing key was generated on this PC at `C:\Users\chinm\.tauri\bunny-torrent.key`.
   **Back it up somewhere private and never commit it.** If it is lost, installed copies can no longer
   be updated (people would have to reinstall).
2. Add it to GitHub: repo → Settings → Secrets and variables → Actions → New repository secret
   - `TAURI_SIGNING_PRIVATE_KEY` = the full contents of that key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = leave empty (the key has no password)
3. The matching public key is already in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

## Every release (automatic)

1. Raise the version in all three places: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. Commit, then tag and push:
   ```
   git tag v0.1.1
   git push origin main --tags
   ```
3. The **Release** workflow builds the installer, signs it, publishes the GitHub release and uploads
   `latest.json`. Installed copies find it at their next start-up check.

## Releasing by hand (no CI)

```
$env:TAURI_SIGNING_PRIVATE_KEY = "C:\Users\chinm\.tauri\bunny-torrent.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npx tauri build
node scripts/make-latest-json.mjs "What changed"
```

Then create a GitHub release tagged `v<version>` and upload the installer from
`src-tauri/target/release/bundle/nsis/` plus the generated `latest.json`.
