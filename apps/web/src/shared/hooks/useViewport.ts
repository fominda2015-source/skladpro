import { useEffect, useState } from "react";

/** Единые брейкпоинты: совпадают с App.css (@media 720 / 900). */
export const VIEWPORT_BREAKPOINTS = {
  mobile: 720,
  tablet: 900
} as const;

export type ViewportMode = "mobile" | "tablet" | "desktop";

function modeFromWidth(width: number): ViewportMode {
  if (width <= VIEWPORT_BREAKPOINTS.mobile) return "mobile";
  if (width <= VIEWPORT_BREAKPOINTS.tablet) return "tablet";
  return "desktop";
}

export function useViewport() {
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
  const [mode, setMode] = useState<ViewportMode>(() => modeFromWidth(width));

  useEffect(() => {
    const sync = () => {
      const w = window.innerWidth;
      setWidth(w);
      setMode(modeFromWidth(w));
    };
    sync();
    window.addEventListener("resize", sync, { passive: true });
    return () => window.removeEventListener("resize", sync);
  }, []);

  return {
    width,
    mode,
    isMobile: mode === "mobile",
    isTablet: mode === "tablet",
    isDesktop: mode === "desktop",
    /** Телефон + планшет — когда нужен компактный UI вместо полного десктопа. */
    isCompact: mode !== "desktop"
  };
}
