import { useCallback, useRef, useState, type ReactNode } from "react";

type Props = {
  enabled?: boolean;
  multiple?: boolean;
  className?: string;
  overlayLabel?: string;
  overlayHint?: string;
  acceptFile?: (file: File) => boolean;
  onFiles: (files: File[]) => void;
  onReject?: () => void;
  children: ReactNode;
};

function isFileDrag(e: React.DragEvent) {
  return Array.from(e.dataTransfer.types).includes("Files");
}

export function PageFileDropZone({
  enabled = true,
  multiple = false,
  className,
  overlayLabel = "Отпустите файлы",
  overlayHint,
  acceptFile,
  onFiles,
  onReject,
  children
}: Props) {
  const [active, setActive] = useState(false);
  const depthRef = useRef(0);

  const resetDrag = useCallback(() => {
    depthRef.current = 0;
    setActive(false);
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !isFileDrag(e)) return;
      e.preventDefault();
      depthRef.current += 1;
      setActive(true);
    },
    [enabled]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      depthRef.current -= 1;
      if (depthRef.current <= 0) resetDrag();
    },
    [enabled, resetDrag]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [enabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resetDrag();
      if (!enabled) return;
      const list = Array.from(e.dataTransfer.files || []);
      if (!list.length) return;
      const picked = multiple ? list : list.slice(0, 1);
      const files = acceptFile ? picked.filter(acceptFile) : picked;
      if (!files.length) {
        onReject?.();
        return;
      }
      onFiles(files);
    },
    [enabled, multiple, acceptFile, onFiles, onReject, resetDrag]
  );

  return (
    <div
      className={`pageFileDropZone${active ? " pageFileDropZone--active" : ""}${className ? ` ${className}` : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {active ? (
        <div className="pageFileDropOverlay" role="presentation" aria-hidden>
          <p className="pageFileDropOverlayTitle">{overlayLabel}</p>
          {overlayHint ? <p className="pageFileDropOverlayHint">{overlayHint}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
