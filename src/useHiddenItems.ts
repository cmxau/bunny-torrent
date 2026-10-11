import { useCallback, useEffect, useRef, useState } from "react";
import type { Filter } from "./filters";
import { store } from "./storage";

/** Sidebar items/groups the person has hidden, persisted in localStorage. */
export function useHiddenItems(filter: Filter, setFilter: (f: Filter) => void) {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    // v3 layout: Overview + Explorer stay in the sidebar, the rest lives in the Filter menu.
    // Anyone can bring the other groups back from Settings → Sidebar.
    if (store.get("sbVer", "") !== "3") {
      return new Set<string>(["group:status", "group:categories", "group:tags", "group:trackers"]);
    }
    try {
      return new Set<string>(JSON.parse(store.get("sbHidden", "[]")));
    } catch {
      return new Set<string>();
    }
  });
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    store.set("sbHidden", JSON.stringify([...hidden]));
    store.set("sbVer", "3"); // after the first save, the stored choice is the source of truth
  }, [hidden]);

  /** Hide/show a sidebar item or group. Hiding the active filter resets it so the list never looks empty for no reason. */
  const toggleHidden = useCallback(
    (id: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          return next;
        }
        next.add(id);
        return next;
      });
      const f = filterRef.current;
      const reset = (patch: Partial<Filter>) => setFilter({ ...f, ...patch });
      if (id.startsWith("group:")) {
        const g = id.slice(6);
        if (g === "overview" || g === "status") reset({ status: "all" });
        else if (g === "explorer") reset({ kind: null });
        else if (g === "categories") reset({ category: null });
        else if (g === "tags") reset({ tag: null });
        else if (g === "trackers") reset({ tracker: null });
      } else if (id.startsWith("status:") && f.status === id.slice(7)) reset({ status: "all" });
      else if (id.startsWith("kind:") && f.kind === id.slice(5)) reset({ kind: null });
      else if (id.startsWith("cat:") && f.category === id.slice(4)) reset({ category: null });
      else if (id.startsWith("tag:") && f.tag === id.slice(4)) reset({ tag: null });
      else if (id.startsWith("trk:") && f.tracker === id.slice(4)) reset({ tracker: null });
    },
    [setFilter],
  );

  const showAll = useCallback(() => setHidden(new Set()), []);

  return { hidden, toggleHidden, showAll };
}
