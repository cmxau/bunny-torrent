import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText } from "./api";
import type { Filter } from "./filters";
import type { PreviewSource } from "./Preview";

export type QueueItem = PreviewSource & { qid: number };

/**
 * Everything that brings torrents in from outside the add dialog: dropped .torrent files, pasted
 * magnet links, links opened from other apps, and the Browse button. Also owns the preview queue.
 */
export function useIncoming(filter: Filter, flash: (m: string) => void, poll: () => void) {
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const qid = useRef(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const enqueue = useCallback((items: PreviewSource[]) => {
    if (items.length) setQueue((q) => [...q, ...items.map((i) => ({ ...i, qid: ++qid.current }))]);
  }, []);

  const quickAdd = useCallback(
    async (paths: string[]) => {
      const files = paths.filter((p) => p.toLowerCase().endsWith(".torrent"));
      if (!files.length) return flash("Only .torrent files can be dropped here");
      const f = filterRef.current;
      try {
        const r = await api.add({
          paths: files,
          category: f.category || null,
          tags: f.tag ? [f.tag] : [],
        });
        flash(
          [r.added && `Added ${r.added} torrent${r.added > 1 ? "s" : ""}`, r.duplicates && `${r.duplicates} already in your list`, r.unsorted && `${r.unsorted} went to the main folder`]
            .filter(Boolean)
            .join(" · ") || "Nothing added",
        );
      } catch (e) {
        flash(errText(e));
      }
      poll();
    },
    [flash, poll],
  );

  const browse = async () => {
    const r = await open({ multiple: true, filters: [{ name: "Torrent", extensions: ["torrent"] }] });
    if (r) quickAdd(Array.isArray(r) ? r : [r]);
  };

  useEffect(() => {
    let un: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const t = e.payload.type;
        if (t === "enter" || t === "over") setDragging(true);
        else if (t === "leave") setDragging(false);
        else if (t === "drop") {
          setDragging(false);
          quickAdd(e.payload.paths);
        }
      })
      .then((f) => (un = f))
      .catch(() => {});
    return () => un?.();
  }, [quickAdd]);

  // magnet links / .torrent files opened from outside the app (a click on a website, a double-click)
  useEffect(() => {
    const take = () =>
      api
        .takeIncoming()
        .then((items) => {
          if (!items.length) return;
          enqueue(items.map((i) => (i.kind === "magnet" ? { magnet: i.value } : { path: i.value })));
        })
        .catch(() => {});
    take();
    let un: (() => void) | undefined;
    listen("incoming", take).then((f) => (un = f));
    return () => un?.();
  }, [enqueue]);

  // paste a magnet link anywhere
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (/^\s*(magnet:\?|https?:\/\/\S+\.torrent)/i.test(text)) {
        e.preventDefault();
        enqueue([{ magnet: text.trim() }]);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enqueue]);

  return { dragging, queue, setQueue, enqueue, browse };
}
