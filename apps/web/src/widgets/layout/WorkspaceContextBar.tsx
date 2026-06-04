import { ALL_OBJECTS_ID } from "../../app/constants";

type ObjectOption = { id: string; name: string };

type Props = {
  activeObjectId: string;
  canViewAllObjects: boolean;
  objects: ObjectOption[];
  section: "SS" | "EOM";
  onSelectObject: (warehouseId: string) => void;
  onSelectSection: (section: "SS" | "EOM") => void;
  hideObjectSelect?: boolean;
};

export function WorkspaceContextBar(props: Props) {
  const {
    activeObjectId,
    canViewAllObjects,
    objects,
    section,
    onSelectObject,
    onSelectSection,
    hideObjectSelect = false
  } = props;

  return (
    <div className="workspaceContextBar" aria-label="Контекст объекта и раздела">
      {!hideObjectSelect ? (
        <label className="workspaceContextObject">
          <span className="workspaceContextLabel">Активный объект</span>
          <select
            className="workspaceContextObjectSelect"
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
        <div className="workspaceContextObject workspaceContextObjectStatic">
          <span className="workspaceContextLabel">Объекты</span>
          <span className="workspaceContextObjectValue">Все объекты</span>
        </div>
      )}
      <div className="workspaceContextSection">
        <span className="workspaceContextLabel">Раздел</span>
        <div className="sectionToggle workspaceContextSectionToggle" aria-label="Раздел СС/ЭОМ">
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
