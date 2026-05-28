import { useState } from "react";
import { resolvePublicFileUrl } from "../../app/constants";

type Props = {
  fullName: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
};

export function UserAvatar({ fullName, avatarUrl, size = "md" }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const resolved = resolvePublicFileUrl(avatarUrl);
  const initial = fullName.trim().slice(0, 1).toUpperCase() || "?";
  const cls = `chatAvatar chatAvatar-${size}`;
  if (!resolved || imgFailed) {
    return <span className={cls} aria-hidden>{initial}</span>;
  }
  return (
    <img
      src={resolved}
      alt=""
      className={cls}
      onError={() => setImgFailed(true)}
    />
  );
}
