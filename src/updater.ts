import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { store } from "./storage";

export type UpdateState =
  | { s: "idle" }
  | { s: "checking" }
  | { s: "uptodate"; at: number }
  | { s: "available"; version: string; notes: string | null }
  | { s: "downloading"; pct: number | null }
  | { s: "installing" }
  | { s: "error"; msg: string; noRelease: boolean };

const KEY = "lastUpdateCheck";
const SIX_HOURS = 6 * 3600 * 1000;

const lastCheck = () => Number(store.get(KEY, "0"));
const markChecked = () => store.set(KEY, String(Date.now()));

/** "No release yet" and "offline" look the same from here, so say so honestly. */
const describe = (e: unknown): { msg: string; noRelease: boolean } => {
  const text = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
  const noRelease = /404|valid release JSON|not found/i.test(text);
  return {
    noRelease,
    msg: noRelease
      ? "No published release was found. The project may not have released a version yet, or you're offline."
      : "Couldn't check for updates. Check your connection and try again.",
  };
};

export function useUpdater({
  auto,
  downloading,
  flash,
}: {
  auto: boolean;
  /** true while any torrent is downloading; automatic installs wait for it to stop */
  downloading: boolean;
  flash: (m: string) => void;
}) {
  const [state, setState] = useState<UpdateState>({ s: "idle" });
  const found = useRef<Update | null>(null);
  const busy = useRef(false);
  const autoPending = useRef(false);

  const checkNow = useCallback(async (silent = false): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    if (!silent) setState({ s: "checking" });
    try {
      const u = await check();
      markChecked();
      found.current = u;
      if (u) {
        setState({ s: "available", version: u.version, notes: u.body ?? null });
        return true;
      }
      setState({ s: "uptodate", at: Date.now() });
    } catch (e) {
      // a silent startup check should never nag; only a manual check reports the problem
      if (!silent) setState({ s: "error", ...describe(e) });
      else setState({ s: "idle" });
    } finally {
      busy.current = false;
    }
    return false;
  }, []);

  const install = useCallback(async () => {
    const u = found.current;
    if (!u) return;
    autoPending.current = false;
    setState({ s: "downloading", pct: null });
    let total = 0;
    let got = 0;
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          setState({ s: "downloading", pct: total ? Math.min(100, Math.round((got / total) * 100)) : null });
        } else if (ev.event === "Finished") setState({ s: "installing" });
      });
      await relaunch();
    } catch (e) {
      setState({ s: "error", ...describe(e) });
    }
  }, []);

  // look for a new version shortly after start (at most every 6 hours); never in development builds
  useEffect(() => {
    if (!auto || import.meta.env.DEV) return;
    if (Date.now() - lastCheck() < SIX_HOURS) return;
    const t = window.setTimeout(async () => {
      if (await checkNow(true)) {
        autoPending.current = true;
        flash("A new version is available. It installs automatically when nothing is downloading.");
      }
    }, 20000);
    return () => window.clearTimeout(t);
  }, [auto, checkNow, flash]);

  // an automatic install waits until downloads are done
  useEffect(() => {
    if (auto && autoPending.current && !downloading && state.s === "available") void install();
  }, [auto, downloading, state, install]);

  return { state, checkNow, install };
}
