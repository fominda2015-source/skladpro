import type { ObjectSection } from "../../shared/accessScope";

type Props = {
  value: ObjectSection;
  allowedSections?: ObjectSection[] | null;
  combinedSections?: boolean;
  onChange: (section: ObjectSection) => void;
  className?: string;
  ariaLabel?: string;
};

export function SectionToggle(props: Props) {
  const {
    value,
    allowedSections = null,
    combinedSections = false,
    onChange,
    className = "sectionToggle sectionToggle--accent",
    ariaLabel = "Раздел СС/ЭОМ"
  } = props;

  const ssAllowed = allowedSections === null || allowedSections.includes("SS");
  const eomAllowed = allowedSections === null || allowedSections.includes("EOM");
  const singleSectionOnly =
    !combinedSections && ((ssAllowed && !eomAllowed) || (!ssAllowed && eomAllowed));

  if (singleSectionOnly) {
    return (
      <span className="workspaceContextObjectValue">{ssAllowed ? "СС" : "ЭОМ"}</span>
    );
  }

  const ssActive = combinedSections || value === "SS";
  const eomActive = combinedSections || value === "EOM";

  return (
    <div
      className={`${className}${combinedSections ? " sectionToggle--combined" : ""}`}
      aria-label={combinedSections ? "Разделы СС и ЭОМ — сводка" : ariaLabel}
    >
      <button
        type="button"
        className={`sectionToggleBtn ${ssActive ? "active" : ""}`}
        onClick={() => onChange("SS")}
        disabled={combinedSections || !ssAllowed}
        aria-pressed={ssActive}
        title={!ssAllowed ? "Нет доступа к разделу СС" : undefined}
      >
        СС
      </button>
      <button
        type="button"
        className={`sectionToggleBtn ${eomActive ? "active" : ""}`}
        onClick={() => onChange("EOM")}
        disabled={combinedSections || !eomAllowed}
        aria-pressed={eomActive}
        title={!eomAllowed ? "Нет доступа к разделу ЭОМ" : undefined}
      >
        ЭОМ
      </button>
    </div>
  );
}
