# Contributing

Thanks for helping. By contributing you agree your work is released under the project's MIT licence. Please read [ARCHITECTURE.md](ARCHITECTURE.md) first and set up with [INSTALLATION.md](INSTALLATION.md).

## Ground rules

1. **Speed first.** Changes must not slow transfers or raise idle CPU, memory or disk use. If you add polling, timers or writes, say why in the pull request.
2. **Be honest in the UI.** Do not show numbers or controls the engine cannot back (see "Engine limits" in the architecture doc).
3. **Remove before adding.** Prefer deleting or simplifying code to adding layers. No half-finished features.
4. **Never commit secrets.** Signing keys (`*.key`, `.tauri/`) are git-ignored; keep it that way.
5. **Respect networks.** No features whose purpose is to evade a network owner's filtering.

## Workflow

1. Fork and branch from `main` (`feature/short-name` or `fix/short-name`).
2. Make a focused change. One topic per pull request.
3. Run the checks below.
4. Open a pull request describing what changed, why, and how you tested it. Screenshots help for UI changes.

## Checks before you push

```
npx tsc --noEmit
cd src-tauri
cargo test
cargo clippy
```

Backend behaviour that matters (queue, seeding, adding, watching) is tested against a real engine on temporary folders. Add a test when you change that logic. Tests must never write the Windows registry or touch `%APPDATA%\BunnyTorrent`.

## Code style

- Write code that reads like its neighbours: same naming, same comment density.
- Rust: `cargo fmt`, no `unwrap()` in non-test code unless the invariant is obvious, small modules with one job.
- TypeScript: strict types, no `any`, function components and hooks, plain CSS in `styles.css` using the existing variables.
- Settings structs use `#[serde(default)]` and camelCase so old `store.json` files keep loading. Adding a setting must not break existing users.
- Comments explain why, not what.

## Adding a backend command

1. Implement it in the right module and add it to `generate_handler!` in `main.rs`.
2. Add the typed wrapper and any types to `src/api.ts`.
3. Keep payloads small; the UI polls, so avoid heavy work in snapshot paths.

## Reporting bugs

Open an issue with the Bunny Torrent version (About page), Windows version, steps to reproduce, and what you expected. Do not paste private tracker URLs or magnet links you do not want public.

## Releases

Maintainers only; see [RELEASING.md](RELEASING.md).
