import { useEffect, useRef, useState } from "react";

type NavItem = {
  id: string;
  label: string;
  icon: string;
  badge?: number;
  disabled?: boolean;
  onClick: () => void;
  active?: boolean;
};

type Props = {
  items: NavItem[];
};

export function MobileBottomNav({ items }: Props) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef<number>(typeof window !== "undefined" ? window.scrollY : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafRef.current = window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY.current;
        if (y < 80) {
          setHidden(false);
        } else if (delta > 8) {
          setHidden(true);
        } else if (delta < -8) {
          setHidden(false);
        }
        lastY.current = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <nav className={`bottomNav ${hidden ? "hidden" : ""}`} aria-label="Мобильная навигация">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`bottomNavBtn ${it.active ? "active" : ""}`}
          disabled={it.disabled}
          onClick={() => {
            if (it.disabled) return;
            it.onClick();
          }}
        >
          <span className="bottomNavIco" aria-hidden>{it.icon}</span>
          <span className="bottomNavLabel">{it.label}</span>
          {typeof it.badge === "number" && it.badge > 0 ? (
            <span className="bottomNavBadge" aria-label={`непрочитанных: ${it.badge}`}>
              {it.badge > 99 ? "99+" : it.badge}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
