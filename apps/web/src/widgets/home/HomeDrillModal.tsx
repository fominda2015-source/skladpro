import type { ReactNode } from "react";
import { HomeSectionToggle, type HomeSection } from "./HomeSectionToggle";

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onDetails?: () => void;
  detailsLabel?: string;
  onBack?: () => void;
  onForward?: () => void;
  canBack?: boolean;
  canForward?: boolean;
  /** Широкое окно для лимитов (таблицы как во вкладке) */
  size?: "default" | "wide";
  drillSection?: HomeSection;
  onDrillSectionChange?: (section: HomeSection) => void;
  children: ReactNode;
};

export function HomeDrillModal({
  title,
  subtitle,
  onClose,
  onDetails,
  detailsLabel = "Подробнее",
  onBack,
  onForward,
  canBack = false,
  canForward = false,
  size = "default",
  drillSection,
  onDrillSectionChange,
  children
}: Props) {
  return (
    <div className="homeDrillBackdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className={`homeDrillModal card${size === "wide" ? " homeDrillModal--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="homeDrillHead">
          <div className="homeDrillHeadMain">
            <div>
              <h3>{title}</h3>
              {subtitle ? <p className="muted">{subtitle}</p> : null}
            </div>
            {drillSection && onDrillSectionChange ? (
              <HomeSectionToggle section={drillSection} onSelect={onDrillSectionChange} />
            ) : null}
          </div>
          <div className="homeDrillHeadActions">
            <button type="button" className="ghostBtn homeDrillNavBtn" onClick={onBack} disabled={!canBack}>
              ←
            </button>
            <button type="button" className="ghostBtn homeDrillNavBtn" onClick={onForward} disabled={!canForward}>
              →
            </button>
            <button type="button" className="ghostBtn homeDrillClose" onClick={onClose} aria-label="Закрыть">
              ×
            </button>
          </div>
        </header>
        <div className="homeDrillBody">{children}</div>
        <footer className="homeDrillFoot">
          {onDetails ? (
            <button
              type="button"
              className="primaryBtn"
              onClick={() => {
                onDetails();
                onClose();
              }}
            >
              {detailsLabel}
            </button>
          ) : null}
          <button type="button" className="ghostBtn" onClick={onClose}>
            Закрыть
          </button>
        </footer>
      </div>
    </div>
  );
}
