import { useEffect, useRef } from "react";
import { CHAT_EMOJIS } from "./chatEmojis";

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
};

export function ChatEmojiPicker({ open, onClose, onPick }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={rootRef} className="chatEmojiPicker" role="dialog" aria-label="Эмодзи">
      <div className="chatEmojiPickerGrid">
        {CHAT_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="chatEmojiPickerBtn"
            title={emoji}
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
