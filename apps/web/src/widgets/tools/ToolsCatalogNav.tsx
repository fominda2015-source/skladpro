import { toolsNavTitle, type ToolsNavId } from "./toolCatalog";

const ROOT_LABEL = "Инструменты/СИЗ";

type Props = {
  navPath: ToolsNavId[];
  onNavPathChange: (path: ToolsNavId[]) => void;
  onBack: () => void;
};

export function ToolsCatalogNav({ navPath, onNavPathChange, onBack }: Props) {
  const atHub = navPath.length <= 1;
  const segments = navPath.slice(1);

  return (
    <nav className="toolsCatalogNav" aria-label="Навигация по каталогу">
      {!atHub ? (
        <button type="button" className="toolsCatalogNavBack" onClick={onBack}>
          <span className="toolsCatalogNavBackIcon" aria-hidden>
            ←
          </span>
          Назад
        </button>
      ) : null}

      <div className="toolsCatalogNavTrail">
        <button
          type="button"
          className={`toolsCatalogNavSeg${atHub && segments.length === 0 ? " toolsCatalogNavSeg--current" : ""}`}
          onClick={() => onNavPathChange(["hub"])}
        >
          {ROOT_LABEL}
        </button>

        {segments.map((seg, idx) => {
          const isLast = idx === segments.length - 1;
          const pathTo = navPath.slice(0, idx + 2);
          return (
            <span key={`${seg}-${idx}`} className="toolsCatalogNavGroup">
              <span className="toolsCatalogNavSep" aria-hidden>
                /
              </span>
              <button
                type="button"
                className={`toolsCatalogNavSeg${isLast ? " toolsCatalogNavSeg--current" : ""}`}
                onClick={() => onNavPathChange(pathTo)}
                aria-current={isLast ? "page" : undefined}
              >
                {toolsNavTitle([seg])}
              </button>
            </span>
          );
        })}
      </div>
    </nav>
  );
}
