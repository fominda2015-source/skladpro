import type { ReactNode } from "react";
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
  /** null — оба раздела; иначе только перечисленные */
  allowedSections?: ("SS" | "EOM")[] | null;
  onSelectObject: (warehouseId: string) => void;
  onSelectSection: (section: "SS" | "EOM") => void;
  hideObjectSelect?: boolean;
  hideObjectControls?: boolean;
  hideSection?: boolean;
  /** На главной: оба раздела выглядят выбранными, переключение отключено */
  combinedSections?: boolean;
  tabFilter?: TabFilterProps;
  layout?: "stacked" | "inline";
  middleSlot?: ReactNode;
};

export function WorkspaceContextBar(props: Props) {
  const {
    activeObjectId,
    canViewAllObjects,
    objects,
    section,
    allowedSections = null,
    onSelectObject,
    onSelectSection,
    hideObjectSelect = false,
    hideObjectControls = false,
    hideSection = false,
    combinedSections = false,
    tabFilter,
    layout = "inline",
    middleSlot
  } = props;

  const ssAllowed = allowedSections === null || allowedSections.includes("SS");
  const eomAllowed = allowedSections === null || allowedSections.includes("EOM");
  const singleSectionOnly =
    !combinedSections && ((ssAllowed && !eomAllowed) || (!ssAllowed && eomAllowed));
  const hideSectionToggle = hideSection || singleSectionOnly;

  const ssActive = combinedSections || section === "SS" || (singleSectionOnly && ssAllowed);
  const eomActive = combinedSections || section === "EOM" || (singleSectionOnly && eomAllowed);

  return (
    <div
      className={`workspaceContextBar${layout === "inline" ? " workspaceContextBar--inline" : ""}`}
      aria-label="Контекст объекта и раздела"
    >
      {!hideObjectControls && !hideObjectSelect ? (
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
      ) : !hideObjectControls && hideObjectSelect ? (
        <div className="workspaceContextObject workspaceContextObjectStatic workspaceContextObject--accent">
          <span className="workspaceContextLabel">Объекты</span>
          <span className="workspaceContextObjectValue workspaceContextObjectValue--accent">Все объекты</span>
        </div>
      ) : null}
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
      {middleSlot}
      {!hideSectionToggle ? (
      <div className="workspaceContextSection workspaceContextSection--accent">
        <span className="workspaceContextLabel">Раздел</span>
        <div
          className={`sectionToggle sectionToggle--accent workspaceContextSectionToggle${combinedSections ? " sectionToggle--combined" : ""}`}
          aria-label={combinedSections ? "Разделы СС и ЭОМ — сводка" : "Раздел СС/ЭОМ"}
        >
          <button
            type="button"
            className={`sectionToggleBtn ${ssActive ? "active" : ""}`}
            onClick={() => onSelectSection("SS")}
            disabled={combinedSections || !ssAllowed}
            aria-pressed={ssActive}
            title={!ssAllowed ? "Нет доступа к разделу СС" : undefined}
          >
            СС
          </button>
          <button
            type="button"
            className={`sectionToggleBtn ${eomActive ? "active" : ""}`}
            onClick={() => onSelectSection("EOM")}
            disabled={combinedSections || !eomAllowed}
            aria-pressed={eomActive}
            title={!eomAllowed ? "Нет доступа к разделу ЭОМ" : undefined}
          >
            ЭОМ
          </button>
        </div>
      </div>
      ) : singleSectionOnly && !hideSection ? (
        <div className="workspaceContextSection workspaceContextSection--accent workspaceContextSectionStatic">
          <span className="workspaceContextLabel">Раздел</span>
          <span className="workspaceContextObjectValue">{ssAllowed ? "СС" : "ЭОМ"}</span>
        </div>
      ) : null}
    </div>
  );
}
