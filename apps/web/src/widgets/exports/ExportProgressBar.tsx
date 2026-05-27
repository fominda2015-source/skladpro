import type { ExportProgressState } from "../../shared/exportXlsx";

type Props = {
  progress: ExportProgressState | null;
};

export function ExportProgressBar({ progress }: Props) {
  if (!progress) return null;
  const indeterminate = progress.percent == null && progress.phase !== "done";

  return (
    <div className="exportProgressWrap" role="status" aria-live="polite">
      <div className="exportProgressTrack" aria-hidden>
        <div
          className={`exportProgressFill${indeterminate ? " exportProgressIndeterminate" : ""}`}
          style={progress.percent != null ? { width: `${progress.percent}%` } : undefined}
        />
      </div>
      <div className="exportProgressMeta">
        <span>{progress.detail}</span>
        <span className="muted">{progress.elapsedSec} с</span>
      </div>
    </div>
  );
}
