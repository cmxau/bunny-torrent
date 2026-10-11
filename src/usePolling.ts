import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, type Snapshot } from "./api";
import type { SessionBase } from "./Details";

export const GLOBAL_HIST = 60;
const TORRENT_HIST = 120;
const zeros = (n: number) => Array<number>(n).fill(0);

/**
 * Polls the engine snapshot and keeps the speed history. Unchanged snapshots cause no re-render,
 * the history lives in refs (a re-render is only requested while the torrents view is on screen),
 * and nothing is polled while the window is hidden (the backend sends the OS notifications itself).
 */
export function usePolling(viewRef: MutableRefObject<string>) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [, setHistTick] = useState(0);
  const lastSnap = useRef("");
  const histRef = useRef({ d: zeros(GLOBAL_HIST), u: zeros(GLOBAL_HIST) });
  const perTorrent = useRef(new Map<number, { d: number[]; u: number[] }>());
  /** Byte counters when this app session first saw each torrent, for the "this session" figures. */
  const base = useRef(new Map<string, SessionBase>());

  const poll = useCallback(async () => {
    try {
      const s = await api.snapshot();
      const text = JSON.stringify(s);
      if (text !== lastSnap.current) {
        lastSnap.current = text;
        setSnap(s); // unchanged stats (the idle case) cause no re-render at all
      }
      let d = 0;
      let u = 0;
      const seen = new Set<number>();
      for (const t of s.torrents) {
        d += t.downBps;
        u += t.upBps;
        seen.add(t.id);
        if (!base.current.has(t.hash) && t.state !== "checking" && t.totalBytes > 0) {
          base.current.set(t.hash, { down: t.downloadedBytes, up: t.uploadedBytes, t0: Date.now() });
        }
        const h = perTorrent.current.get(t.id) ?? { d: zeros(TORRENT_HIST), u: zeros(TORRENT_HIST) };
        h.d = [...h.d.slice(1), t.downBps];
        h.u = [...h.u.slice(1), t.upBps];
        perTorrent.current.set(t.id, h);
      }
      for (const id of perTorrent.current.keys()) if (!seen.has(id)) perTorrent.current.delete(id);
      const h = histRef.current;
      histRef.current = { d: [...h.d.slice(1), d], u: [...h.u.slice(1), u] };
      if (!document.hidden && viewRef.current === "torrents") setHistTick((n) => n + 1);
    } catch (e) {
      console.error(e);
    }
  }, [viewRef]);

  // Poll once a second while the window is visible. When it's minimised there is nothing to redraw, so stop.
  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      if (!document.hidden) await poll();
      timer = window.setTimeout(loop, document.hidden ? 5000 : 1000);
    };
    const onVisible = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        loop(); // catch up immediately when the window comes back
      }
    };
    loop();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  return { snap, poll, histRef, perTorrent, base };
}
