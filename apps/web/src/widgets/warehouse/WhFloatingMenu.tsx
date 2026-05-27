import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

const itemBase: CSSProperties = {
  display: "block",
  width: "100%",
  margin: 0,
  padding: "10px 12px",
  border: "none",
  borderRadius: 8,
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 14,
  fontWeight: 500,
  lineHeight: 1.35,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
  WebkitAppearance: "none",
  appearance: "none"
};

type MenuActionProps = {
  label: string;
  danger?: boolean;
  onActivate: () => void;
};

export function WhMenuAction({ label, danger, onActivate }: MenuActionProps) {
  return (
    <div
      role="menuitem"
      tabIndex={0}
      style={{
        ...itemBase,
        color: danger ? "#b91c1c" : "#0f172a",
        background: "#ffffff"
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "#fef2f2" : "#f1f5f9";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#ffffff";
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
    >
      {label}
    </div>
  );
}

type FloatingMenuProps = {
  anchorRect: DOMRect;
  onClose: () => void;
  children: ReactNode;
};

export function WhFloatingMenu({ anchorRect, onClose, children }: FloatingMenuProps) {
  const top = anchorRect.bottom + 4;
  const right = Math.max(8, window.innerWidth - anchorRect.right);

  return createPortal(
    <>
      <div
        className="whMenuBackdrop"
        aria-hidden
        onPointerDown={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="whMenu whMenuFloating"
        role="menu"
        style={{
          position: "fixed",
          top,
          right,
          left: "auto",
          minWidth: 220,
          zIndex: 1200,
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 10,
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.15)",
          padding: 6
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  );
}
