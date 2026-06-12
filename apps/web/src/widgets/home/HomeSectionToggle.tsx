export type HomeSection = "SS" | "EOM";

type Props = {
  section: HomeSection;
  onSelect: (section: HomeSection) => void;
  className?: string;
};

export function HomeSectionToggle({ section, onSelect, className }: Props) {
  return (
    <div
      className={`sectionToggle sectionToggle--accent homeDrillSectionToggle${className ? ` ${className}` : ""}`}
      aria-label="Раздел СС/ЭОМ"
    >
      <button
        type="button"
        className={`sectionToggleBtn ${section === "SS" ? "active" : ""}`}
        onClick={() => onSelect("SS")}
      >
        СС
      </button>
      <button
        type="button"
        className={`sectionToggleBtn ${section === "EOM" ? "active" : ""}`}
        onClick={() => onSelect("EOM")}
      >
        ЭОМ
      </button>
    </div>
  );
}
