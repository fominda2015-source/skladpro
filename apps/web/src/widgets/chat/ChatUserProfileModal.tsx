import { useEffect, useState } from "react";
import { resolvePublicFileUrl } from "../../app/constants";

export type ChatUserProfile = {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  avatarUrl?: string | null;
  position?: string | null;
  role: string;
  warehouses: Array<{ id: string; name: string }>;
};

type Props = {
  open: boolean;
  loading: boolean;
  profile: ChatUserProfile | null;
  roleLabel: (role: string) => string;
  safeName: (name: string) => string;
  onClose: () => void;
  onWriteMessage?: () => void;
};

export function ChatUserProfileModal({
  open,
  loading,
  profile,
  roleLabel,
  safeName,
  onClose,
  onWriteMessage
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [profile?.avatarUrl, open]);

  if (!open) return null;

  const resolved = profile?.avatarUrl ? resolvePublicFileUrl(profile.avatarUrl) : null;
  const initial = profile?.fullName.trim().slice(0, 1).toUpperCase() || "?";
  const phoneLabel = profile?.phone?.trim() ? profile.phone.trim() : "отсутствует";
  const warehouseNames =
    profile?.warehouses?.length ? profile.warehouses.map((w) => safeName(w.name)).join(", ") : "—";

  return (
    <div
      className="chatUserProfileBackdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="chatUserProfileCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chatUserProfileTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="chatUserProfileClose ghostBtn" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
        {loading || !profile ? (
          <p className="muted" style={{ margin: 24 }}>
            Загрузка…
          </p>
        ) : (
          <>
            <div className="chatUserProfileAvatarWrap">
              {resolved && !imgFailed ? (
                <img
                  src={resolved}
                  alt=""
                  className="chatUserProfileAvatar"
                  onError={() => setImgFailed(true)}
                />
              ) : (
                <span className="chatUserProfileAvatar chatUserProfileAvatar--fallback" aria-hidden>
                  {initial}
                </span>
              )}
            </div>
            <h3 id="chatUserProfileTitle" className="chatUserProfileName">
              {profile.fullName}
            </h3>
            <dl className="chatUserProfileMeta">
              <div>
                <dt>Телефон</dt>
                <dd>{phoneLabel}</dd>
              </div>
              <div>
                <dt>Почта</dt>
                <dd>{profile.email || "—"}</dd>
              </div>
              <div>
                <dt>Должность</dt>
                <dd>{profile.position?.trim() || roleLabel(profile.role) || "—"}</dd>
              </div>
              <div>
                <dt>Объекты</dt>
                <dd>{warehouseNames}</dd>
              </div>
            </dl>
            {onWriteMessage ? (
              <div className="chatUserProfileActions">
                <button type="button" className="primaryBtn" onClick={onWriteMessage}>
                  Написать
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
