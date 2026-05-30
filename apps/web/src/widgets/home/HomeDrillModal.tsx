import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onDetails?: () => void;
  detailsLabel?: string;
  children: ReactNode;
};

export function HomeDrillModal({
  title,
  subtitle,
  onClose,
  onDetails,
  detailsLabel = "Подробнее",
  children
}: Props) {
  return (
    <div className="homeDrillBackdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="homeDrillModal card" onClick={(e) => e.stopPropagation()}>
        <header className="homeDrillHead">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          <button type="button" className="ghostBtn homeDrillClose" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
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
