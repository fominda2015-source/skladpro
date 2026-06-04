import { ALL_OBJECTS_ID } from "../../app/constants";

type ObjectOption = { id: string; name: string };

type TabFilterProps = {
  value: string;
  warehouses: ObjectOption[];
  sectionLabel?: string;
  onChange: (warehouseId: string) => void;
};

type Props = {
  activeObjectId: string;
  canViewAllObjects: boolean;
  objects: ObjectOption[];
  section: "SS" | "EOM";
  onSelectObject: (warehouseId: string) => void;
  onSelectSection: (section: "SS" | "EOM") => void;
  hideObjectSelect?: boolean;
  tabFilter?: TabFilterProps;
  layout?: "stacked" | "inline";
};

export function WorkspaceContextBar(props: Props) {
  const {
    activeObjectId,
    canViewAllObjects,
    objects,
    section,
    onSelectObject,
    onSelectSection,
    hideObjectSelect = false,
    tabFilter,
    layout = "inline"
  } = props;

  return (
    <div
      className={`workspaceContextBar${layout === "inline" ? " workspaceContextBar--inline" : ""}`}
      aria-label="Контекст объекта и раздела"
    >
      {!hideObjectSelect ? (
        <label className="workspaceContextObject workspaceContextObject--accent">
          <span className="workspaceContextLabel">Активный объект</span>
          <select
            className="workspaceContextObjectSelect workspaceContextObjectSelect--accent"
            value={activeObjectId}
            onChange={(e) => onSelectObject(e.target.value)}
            aria-label="Выбор объекта"
          >
            {canViewAllObjects ? <option value={ALL_OBJECTS_ID}>Все объекты</option> : null}
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="workspaceContextObject workspaceContextObjectStatic workspaceContextObject--accent">
          <span className="workspaceContextLabel">Объекты</span>
          <span className="workspaceContextObjectValue workspaceContextObjectValue--accent">Все объекты</span>
        </div>
      )}
      {tabFilter ? (
        <label className="workspaceContextObject workspaceContextTabFilter workspaceContextObject--accent-secondary">
          <span className="workspaceContextLabel">Объект на вкладке</span>
          <select
            className="workspaceContextObjectSelect workspaceContextObjectSelect--accent-secondary"
            value={tabFilter.value}
            onChange={(e) => tabFilter.onChange(e.target.value)}
            aria-label="Фильтр по объекту на вкладке"
          >
            <option value="">Все доступные объекты</option>
            {tabFilter.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="workspaceContextSection workspaceContextSection--accent">
        <span className="workspaceContextLabel">Раздел</span>
        <div
          className="sectionToggle sectionToggle--accent workspaceContextSectionToggle"
          aria-label="Раздел СС/ЭОМ"
        >
          <button
            type="button"
            className={`sectionToggleBtn ${section === "SS" ? "active" : ""}`}
            onClick={() => onSelectSection("SS")}
          >
            СС
          </button>
          <button
            type="button"
            className={`sectionToggleBtn ${section === "EOM" ? "active" : ""}`}
            onClick={() => onSelectSection("EOM")}
          >
            ЭОМ
          </button>
        </div>
      </div>
    </div>
  );
}
