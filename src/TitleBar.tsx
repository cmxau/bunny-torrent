import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar() {
  const win = getCurrentWindow();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <img src="/bunny.svg" width="22" height="22" alt="" draggable={false} />
        <b>BUNNY TORRENT</b>
      </div>
      <div className="winctl">
        <button onClick={() => win.minimize()} aria-label="Minimize">
          <svg width="10" height="10"><path d="M0 5h10" stroke="currentColor" /></svg>
        </button>
        <button onClick={() => win.toggleMaximize()} aria-label="Maximize">
          <svg width="10" height="10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
        </button>
        <button className="close" onClick={() => win.close()} aria-label="Close">
          <svg width="10" height="10"><path d="M0 0l10 10M10 0 0 10" stroke="currentColor" /></svg>
        </button>
      </div>
    </header>
  );
}
