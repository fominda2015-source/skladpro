import { useEffect, useMemo, useState } from "react";
import { displayDocumentFileName } from "../../shared/fileName";
import {
  collectDocumentSiblings,
  detectDocumentPreviewKind,
  documentFileUrl,
  documentPreviewKindLabel,
  isBrowserInlinePreview,
  type DocumentPreviewFile
} from "../../shared/documentPreview";
import "./documentPreview.css";

type Props<T extends DocumentPreviewFile = DocumentPreviewFile> = {
  file: T;
  apiUrl: string;
  allFiles?: T[];
  onSelectFile?: (file: T) => void;
  fetchWithAuth?: (url: string) => Promise<Response>;
};

function fallbackIcon(kind: ReturnType<typeof detectDocumentPreviewKind>): string {
  if (kind === "spreadsheet") return "📊";
  if (kind === "office") return "📄";
  if (kind === "pdf") return "📕";
  if (kind === "image") return "🖼";
  return "📎";
}

export function DocumentFilePreview<T extends DocumentPreviewFile = DocumentPreviewFile>({
  file,
  apiUrl,
  allFiles,
  onSelectFile,
  fetchWithAuth
}: Props<T>) {
  const [textContent, setTextContent] = useState("");
  const [textError, setTextError] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const fileUrl = documentFileUrl(apiUrl, file.filePath);
  const kind = detectDocumentPreviewKind(file.mimeType, file.fileName);
  const shownName = displayDocumentFileName(file.fileName, {
    type: file.type,
    title: file.title
  });

  const siblings = useMemo(() => {
    if (!allFiles?.length) return [file];
    return collectDocumentSiblings(file, allFiles);
  }, [allFiles, file]);

  useEffect(() => {
    setTextContent("");
    setTextError("");
    if (kind !== "text" || !fetchWithAuth) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(fileUrl);
        if (!res.ok) {
          if (!cancelled) setTextError("Не удалось загрузить текст файла");
          return;
        }
        const body = await res.text();
        if (!cancelled) setTextContent(body.slice(0, 200_000));
      } catch {
        if (!cancelled) setTextError("Не удалось загрузить текст файла");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, fileUrl, kind]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);

  return (
    <>
      {siblings.length > 1 ? (
        <div className="docPreviewToolbar">
          {siblings.map((sibling) => {
            const active = sibling.id === file.id;
            return (
              <button
                key={sibling.id}
                type="button"
                className={active ? "primaryBtn" : "ghostBtn"}
                style={{ fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
                title={sibling.fileName}
                onClick={() => onSelectFile?.(sibling)}
              >
                {sibling.fileName}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="docPreviewToolbar">
        <a className="ghostBtn" href={fileUrl} target="_blank" rel="noreferrer" download={shownName}>
          ↓ Скачать
        </a>
        {kind === "image" ? (
          <button type="button" className="ghostBtn" onClick={() => setLightboxOpen(true)}>
            ⛶ На весь экран
          </button>
        ) : null}
        {!isBrowserInlinePreview(kind) ? (
          <a className="ghostBtn" href={fileUrl} target="_blank" rel="noreferrer">
            Открыть в новой вкладке
          </a>
        ) : null}
      </div>

      {kind === "pdf" ? (
        <iframe className="docPreviewFrame" src={fileUrl} title={shownName} />
      ) : null}

      {kind === "image" ? (
        <div
          className="docPreviewImageWrap"
          role="button"
          tabIndex={0}
          title="Нажмите для просмотра на весь экран"
          onClick={() => setLightboxOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setLightboxOpen(true);
            }
          }}
        >
          <img className="docPreviewImage" src={fileUrl} alt={shownName} />
        </div>
      ) : null}

      {kind === "text" ? (
        textError ? (
          <div className="docPreviewFallback">
            <p className="muted">{textError}</p>
            <a className="primaryBtn" href={fileUrl} download={shownName}>
              Скачать файл
            </a>
          </div>
        ) : textContent ? (
          <pre className="docPreviewText">{textContent}</pre>
        ) : (
          <p className="muted">Загрузка текста…</p>
        )
      ) : null}

      {!isBrowserInlinePreview(kind) ? (
        <div className="docPreviewFallback">
          <span className="docPreviewFallbackIcon" aria-hidden>
            {fallbackIcon(kind)}
          </span>
          <strong>{shownName}</strong>
          <p className="muted" style={{ margin: 0 }}>
            {documentPreviewKindLabel(kind)} · предпросмотр в браузере недоступен
          </p>
          <a className="primaryBtn" href={fileUrl} download={shownName}>
            Скачать файл
          </a>
        </div>
      ) : null}

      {lightboxOpen && kind === "image" ? (
        <div
          className="docPreviewLightbox"
          role="dialog"
          aria-modal="true"
          aria-label={shownName}
          onClick={() => setLightboxOpen(false)}
        >
          <div className="docPreviewLightboxTop" onClick={(e) => e.stopPropagation()}>
            <span>{shownName}</span>
            <div className="toolbar">
              <a className="ghostBtn" href={fileUrl} download={shownName} style={{ color: "#f8fafc" }}>
                ↓ Скачать
              </a>
              <button type="button" className="ghostBtn" style={{ color: "#f8fafc" }} onClick={() => setLightboxOpen(false)}>
                ✕ Закрыть
              </button>
            </div>
          </div>
          <div className="docPreviewLightboxBody" onClick={(e) => e.stopPropagation()}>
            <img className="docPreviewLightboxImg" src={fileUrl} alt={shownName} onClick={() => setLightboxOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
