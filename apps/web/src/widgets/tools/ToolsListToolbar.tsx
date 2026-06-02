import { useState, type ReactNode } from "react";

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters: ReactNode;
  actions?: ReactNode;
  filtersOpenDefault?: boolean;
};

export function ToolsListToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Поиск…",
  filters,
  actions,
  filtersOpenDefault = false
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(filtersOpenDefault);

  return (
    <div className="toolsListToolbar">
      <div className="toolsListToolbarRow">
        <input
          type="search"
          className="toolsListToolbarSearch"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Поиск"
        />
        <button
          type="button"
          className={`toolsListToolbarFilterBtn ghostBtn${filtersOpen ? " active" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          title="Фильтры"
        >
          ⚙ Фильтры
        </button>
        {actions ? <div className="toolsListToolbarActions">{actions}</div> : null}
      </div>
      {filtersOpen ? <div className="toolsListToolbarFilters">{filters}</div> : null}
    </div>
  );
}
