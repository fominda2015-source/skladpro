import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_FILE_ACCEPT,
  isChatFileAllowed,
  mergeChatFiles,
  pickFilesFromClipboard
} from "./chatFiles";

type Props = {
  text: string;
  attachments: File[];
  quickReplies: string[];
  canSend: boolean;
  onTextChange: (v: string) => void;
  onAttachmentsChange: (files: File[]) => void;
  onSend: () => void | Promise<void>;
  onFileReject?: (reason: string) => void;
};

export function ChatComposer({
  text,
  attachments,
  quickReplies,
  canSend,
  onTextChange,
  onAttachmentsChange,
  onSend,
  onFileReject
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fileKey = (f: File, i: number) => `${f.name}-${f.size}-${f.lastModified}-${i}`;

  useEffect(() => {
    const urls: Record<string, string> = {};
    attachments.forEach((f, i) => {
      if (f.type.startsWith("image/")) {
        urls[fileKey(f, i)] = URL.createObjectURL(f);
      }
    });
    setPreviewUrls(urls);
    return () => {
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [attachments]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      const allowed = incoming.filter(isChatFileAllowed);
      if (!allowed.length) {
        onFileReject?.("Поддерживаются изображения и PDF");
        return;
      }
      if (allowed.length < incoming.length) {
        onFileReject?.("Часть файлов пропущена — только изображения и PDF");
      }
      onAttachmentsChange(mergeChatFiles(attachments, allowed));
    },
    [attachments, onAttachmentsChange, onFileReject]
  );

  const removeAt = (index: number) => {
    onAttachmentsChange(attachments.filter((_, i) => i !== index));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = pickFilesFromClipboard(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <footer
      className={`chatThreadComposer ${dragOver ? "chatThreadComposer--drag" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {dragOver ? (
        <div className="chatDropOverlay" aria-hidden>
          Отпустите файлы — добавим во вложения
        </div>
      ) : null}

      <div className="chatQuickReplies">
        {quickReplies.map((q) => (
          <button key={q} type="button" className="ghostBtn" onClick={() => onTextChange(q)}>
            {q}
          </button>
        ))}
      </div>

      {attachments.length > 0 ? (
        <div className="chatAttachmentPreviewList">
          {attachments.map((f, i) => {
            const key = fileKey(f, i);
            const thumb = previewUrls[key];
            return (
              <div key={key} className="chatAttachmentPreview">
                {thumb ? (
                  <img src={thumb} alt="" className="chatAttachmentPreviewImg" />
                ) : (
                  <span className="chatAttachmentPreviewFile" aria-hidden>
                    📄
                  </span>
                )}
                <span className="chatAttachmentPreviewName" title={f.name}>
                  {f.name}
                </span>
                <button
                  type="button"
                  className="chatAttachmentPreviewRemove"
                  aria-label="Убрать вложение"
                  onClick={() => removeAt(i)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="chatComposerRow">
        <button
          type="button"
          className="ghostBtn chatAttachBtn"
          title="Прикрепить файл"
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          className="chatHiddenFile"
          type="file"
          accept={CHAT_FILE_ACCEPT}
          multiple
          onChange={(e) => {
            if (e.target.files?.length) addFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        <textarea
          className="chatComposerInput"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={onPaste}
          placeholder="Сообщение… (Ctrl+V — вставить скрин)"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) void onSend();
            }
          }}
        />
        <button type="button" className="primaryBtn chatSendBtn" disabled={!canSend} onClick={() => void onSend()}>
          Отправить
        </button>
      </div>
      <p className="chatComposerHint muted">Перетащите файлы сюда или вставьте скриншот из буфера (Ctrl+V)</p>
    </footer>
  );
}
