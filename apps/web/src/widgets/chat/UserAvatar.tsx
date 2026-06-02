import { useState, type MouseEvent } from "react";
import { resolvePublicFileUrl } from "../../app/constants";

type Props = {
  fullName: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
  onClick?: (e: MouseEvent) => void;
};

export function UserAvatar({ fullName, avatarUrl, size = "md", onClick }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const resolved = resolvePublicFileUrl(avatarUrl);
  const initial = fullName.trim().slice(0, 1).toUpperCase() || "?";
  const cls = `chatAvatar chatAvatar-${size}`;
  const inner =
    !resolved || imgFailed ? (
      <span className={cls} aria-hidden>
        {initial}
      </span>
    ) : (
      <img src={resolved} alt="" className={cls} onError={() => setImgFailed(true)} />
    );

  if (onClick) {
    return (
      <button type="button" className="chatAvatarBtn" onClick={onClick} aria-label={`Профиль: ${fullName}`}>
        {inner}
      </button>
    );
  }
  return inner;
}
