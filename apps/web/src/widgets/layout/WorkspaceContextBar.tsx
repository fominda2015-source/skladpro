import type { ReactNode } from "react";
import { ALL_OBJECTS_ID } from "../../app/constants";
import { SectionToggle } from "./SectionToggle";

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
    !combinedSections && !hideSection && ((ssAllowed && !eomAllowed) || (!ssAllowed && eomAllowed));

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
      {!hideSection && !singleSectionOnly ? (
        <div className="workspaceContextSection workspaceContextSection--accent">
          <span className="workspaceContextLabel">Раздел</span>
          <SectionToggle
            value={section}
            allowedSections={allowedSections}
            combinedSections={combinedSections}
            onChange={onSelectSection}
            className="sectionToggle sectionToggle--accent workspaceContextSectionToggle"
          />
        </div>
      ) : singleSectionOnly ? (
        <div className="workspaceContextSection workspaceContextSection--accent workspaceContextSectionStatic">
          <span className="workspaceContextLabel">Раздел</span>
          <SectionToggle value={section} allowedSections={allowedSections} onChange={onSelectSection} />
        </div>
      ) : null}
    </div>
  );
}
