// Builds latest.json (the file the in-app updater reads) from a locally built, signed installer.
// Usage (after `npx tauri build` with TAURI_SIGNING_PRIVATE_KEY set):
//   node scripts/make-latest-json.mjs "Short release notes"
// Then create a GitHub release tagged v<version> and upload two files to it:
//   the installer (.exe) and the generated latest.json (the signature is inside latest.json).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version;
const dir = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
const exe = `Bunny Torrent_${version}_x64-setup.exe`;
const sigFile = path.join(dir, `${exe}.sig`);
if (!fs.existsSync(sigFile)) {
  console.error(`Missing ${sigFile}\nBuild with TAURI_SIGNING_PRIVATE_KEY set so the installer gets signed.`);
  process.exit(1);
}
// GitHub turns spaces in asset names into dots
const assetName = exe.replace(/ /g, ".");
const latest = {
  version,
  notes: process.argv[2] ?? `Bunny Torrent ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: fs.readFileSync(sigFile, "utf8").trim(),
      url: `https://github.com/cmxau/bunny-torrent/releases/download/v${version}/${assetName}`,
    },
  },
};
const out = path.join(dir, "latest.json");
fs.writeFileSync(out, JSON.stringify(latest, null, 2) + "\n");
console.log(`Wrote ${out}\nUpload to release v${version}: "${exe}" and latest.json`);
