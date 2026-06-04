import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type Props = {
  fullName: string;
  avatar: ReactNode;
  onProfile: () => void;
  onSettings: () => void;
  onLogout: () => void;
  showName?: boolean;
};

export function UserAccountMenu(props: Props) {
  const { fullName, avatar, onProfile, onSettings, onLogout, showName = true } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className={`userAccountMenu${open ? " userAccountMenuOpen" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="userAccountMenuTrigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        title={fullName}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="userAvatar userAccountMenuAvatar">{avatar}</span>
        {showName ? <span className="userAccountMenuName">{fullName}</span> : null}
        <span className="userAccountMenuChevron" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div id={menuId} className="userAccountMenuPanel" role="menu">
          <p className="userAccountMenuHead muted">{fullName}</p>
          <button type="button" role="menuitem" className="userAccountMenuItem" onClick={() => pick(onProfile)}>
            Профиль
          </button>
          <button type="button" role="menuitem" className="userAccountMenuItem" onClick={() => pick(onSettings)}>
            Настройки
          </button>
          <button
            type="button"
            role="menuitem"
            className="userAccountMenuItem userAccountMenuItemDanger"
            onClick={() => pick(onLogout)}
          >
            Выйти
          </button>
        </div>
      ) : null}
    </div>
  );
}
