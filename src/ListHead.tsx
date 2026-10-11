import { isFiltered, NO_FILTER, type Filter } from "./filters";
import { activeFilterCount } from "./FilterMenu";
import { Icon, P } from "./ui";
import type { MenuPos } from "./TorrentMenus";

/** Title, search box and the Filter / Columns / Add buttons above the torrent table. */
export function ListHead({
  title,
  count,
  filter,
  setFilter,
  query,
  setQuery,
  searchRef,
  openFilterMenu,
  openColMenu,
  onAdd,
  onCreate,
}: {
  title: string;
  count: number;
  filter: Filter;
  setFilter: (f: Filter) => void;
  query: string;
  setQuery: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement>;
  openFilterMenu: (p: MenuPos) => void;
  openColMenu: (p: MenuPos) => void;
  onAdd: () => void;
  onCreate: () => void;
}) {
  const nFilters = activeFilterCount(filter);
  return (
    <div className="listhead">
      <span className="ttl">
        {title} <em>{count}</em>
      </span>
      {isFiltered(filter) && (
        <button className="lnk" onClick={() => setFilter(NO_FILTER)}>
          Clear filters
        </button>
      )}
      <span className="grow" />
      <label className="tsearch">
        <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" size={14} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your torrents"
          aria-label="Search your torrents"
        />
        {query && (
          <button type="button" className="x" onClick={() => setQuery("")} aria-label="Clear search">
            <Icon d={P.close} size={13} />
          </button>
        )}
      </label>
      <button
        className={`add ghosty ${nFilters ? "has" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openFilterMenu({ x: r.right - 660, y: r.bottom + 6 });
        }}
        title="Filter by status, type, category, tag or tracker"
      >
        <Icon d="M4 5h16l-6 8v6l-4-2v-4z" size={14} /> Filter
        {nFilters > 0 && <b className="fbadge">{nFilters}</b>}
      </button>
      <button
        className="add ghosty"
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openColMenu({ x: r.right - 230, y: r.bottom + 6 });
        }}
        title="Choose which columns to show"
      >
        <Icon d={P.list} size={14} /> Columns
      </button>
      <button className="add ghosty" onClick={onCreate} title="Make a .torrent from a file or folder on your computer">
        <Icon d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 12v6M9 15h6" size={14} /> Create torrent
      </button>
      <button className="add" onClick={onAdd}>
        <Icon d={P.plus} size={14} /> Add torrent
      </button>
    </div>
  );
}
