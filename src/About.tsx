import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AUTHOR_URL, PRIVACY, REPO_URL, TERMS, type LegalSection } from "./legal";
import { GithubIcon, Icon, Modal, Toggle } from "./ui";
import type { UpdateState } from "./updater";

const open = (url: string) => {
  openUrl(url).catch(() => {});
};

function Legal({ title, sections, onClose }: { title: string; sections: LegalSection[]; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="legal">
        {sections.map((s) => (
          <section key={s.h}>
            <h4>{s.h}</h4>
            {s.p.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </section>
        ))}
      </div>
      <div className="mbtns">
        <span />
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function statusLine(u: UpdateState): { text: string; tone?: "ok" | "bad" } {
  switch (u.s) {
    case "idle":
      return { text: "Updates come from the project's GitHub releases." };
    case "checking":
      return { text: "Checking for updates…" };
    case "uptodate":
      return { text: "You're on the latest version.", tone: "ok" };
    case "available":
      return { text: `Version ${u.version} is available.`, tone: "ok" };
    case "downloading":
      return { text: u.pct == null ? "Downloading the update…" : `Downloading the update… ${u.pct}%` };
    case "installing":
      return { text: "Installing. Bunny Torrent will restart in a moment…" };
    case "error":
      return { text: u.msg, tone: u.noRelease ? undefined : "bad" };
  }
}

export function About({
  update,
  onCheck,
  onInstall,
  autoUpdate,
  setAutoUpdate,
}: {
  update: UpdateState;
  onCheck: () => void;
  onInstall: () => void;
  autoUpdate: boolean;
  setAutoUpdate: (v: boolean) => void;
}) {
  const [version, setVersion] = useState("");
  const [legal, setLegal] = useState<null | "terms" | "privacy">(null);
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);
  const status = statusLine(update);
  const working = update.s === "checking" || update.s === "downloading" || update.s === "installing";

  return (
    <div className="about2">
      <header className="ahead">
        <img src="/bunny.svg" width="76" height="76" alt="" />
        <div>
          <h3>Bunny Torrent</h3>
          <span className="ver">{version ? `Version ${version}` : "Version —"}</span>
        </div>
      </header>

      <div className="credit">
        <span>Designed and developed by</span>
        <button className="ghlink" onClick={() => open(AUTHOR_URL)} title={AUTHOR_URL}>
          <GithubIcon size={16} /> cmxau
        </button>
      </div>
      <div className="credit">
        <span>Source code</span>
        <button className="ghlink" onClick={() => open(REPO_URL)} title={REPO_URL}>
          <GithubIcon size={16} /> cmxau/bunny-torrent
        </button>
      </div>

      <section className="updcard" aria-live="polite">
        <div className="updtext">
          <b>Software update</b>
          <span className={status.tone ?? ""}>{status.text}</span>
          {update.s === "available" && update.notes && <pre className="notes">{update.notes}</pre>}
          {update.s === "downloading" && (
            <span className="prog">
              <b style={{ width: `${update.pct ?? 8}%` }} />
            </span>
          )}
        </div>
        <div className="updbtn">
          {update.s === "available" ? (
            <button className="primary" onClick={onInstall}>
              Update and restart
            </button>
          ) : (
            <button className="ghost" disabled={working} onClick={onCheck}>
              <Icon d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" size={14} /> Check for updates
            </button>
          )}
        </div>
      </section>

      <div className="srow compact">
        <div className="stext">
          <b>Update automatically</b>
          <small>
            Check for a new version when the app starts, and install it when nothing is downloading. Updates are signed, so only genuine ones
            install.
          </small>
        </div>
        <div className="sctl">
          <Toggle on={autoUpdate} onChange={setAutoUpdate} label="Update automatically" />
        </div>
      </div>

      <footer className="alinks">
        <button className="lnk" onClick={() => setLegal("terms")}>
          Terms of use
        </button>
        <span aria-hidden>·</span>
        <button className="lnk" onClick={() => setLegal("privacy")}>
          Privacy policy
        </button>
      </footer>
      <small className="faint tiny">Built with Tauri and the librqbit BitTorrent engine.</small>

      {legal === "terms" && <Legal title="Terms of use" sections={TERMS} onClose={() => setLegal(null)} />}
      {legal === "privacy" && <Legal title="Privacy policy" sections={PRIVACY} onClose={() => setLegal(null)} />}
    </div>
  );
}
