import { useCallback, useEffect, useRef, useState } from "react";
import { appendChatFiles, CHAT_FILE_ACCEPT, pickFilesFromClipboard } from "./chatFiles";
import { ChatEmojiPicker } from "./ChatEmojiPicker";

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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
      appendChatFiles(attachments, incoming, onAttachmentsChange, onFileReject);
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

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      onTextChange(text + emoji);
      return;
    }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    onTextChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  return (
    <footer className="chatThreadComposer">
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
          onClick={() => {
            setEmojiOpen(false);
            fileInputRef.current?.click();
          }}
        >
          📎
        </button>
        <div className="chatEmojiWrap">
          <button
            type="button"
            className={`ghostBtn chatEmojiBtn${emojiOpen ? " active" : ""}`}
            title="Эмодзи"
            aria-expanded={emojiOpen}
            aria-haspopup="dialog"
            onClick={() => setEmojiOpen((v) => !v)}
          >
            🙂
          </button>
          <ChatEmojiPicker
            open={emojiOpen}
            onClose={() => setEmojiOpen(false)}
            onPick={insertEmoji}
          />
        </div>
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
          ref={textareaRef}
          className="chatComposerInput"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={onPaste}
          onFocus={() => setEmojiOpen(false)}
          placeholder="Сообщение… (Ctrl+V — вставить скрин)"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) void onSend();
            }
          }}
        />
        <button
          type="button"
          className="chatSendBtn"
          disabled={!canSend}
          onClick={() => void onSend()}
          aria-label="Отправить"
          title="Отправить"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M22 2 11 13" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M22 2 15 22 11 13 2 9 22 2z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p className="chatComposerHint muted">Перетащите файлы на страницу или вставьте скриншот из буфера (Ctrl+V)</p>
    </footer>
  );
}
