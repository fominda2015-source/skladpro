import { useEffect } from "react";

type Props = {
  src: string;
  alt: string;
  onClose: () => void;
};

export function ChatImageLightbox({ src, alt, onClose }: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="chatImageLightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button type="button" className="chatImageLightboxClose" onClick={onClose} aria-label="Закрыть">
        ×
      </button>
      <img src={src} alt={alt} className="chatImageLightboxImg" />
      {alt ? <p className="chatImageLightboxCaption muted">{alt}</p> : null}
    </div>
  );
}
