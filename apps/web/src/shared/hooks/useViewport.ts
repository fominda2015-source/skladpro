import { useEffect, useState } from "react";

/** Брейкпоинты в rem — совпадают с CSS. */
export const VIEWPORT_BREAKPOINTS = {
  mobile: 45, // rem → 720px при 16px root
  tablet: 56.25 // rem → 900px
} as const;

export type ViewportMode = "mobile" | "tablet" | "desktop";

export type ViewportState = {
  mode: ViewportMode;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** Телефон + планшет — компактный UI (≤900px). */
  isCompact: boolean;
};

function modeFromQueries(isMobile: boolean, isCompact: boolean): ViewportMode {
  if (isMobile) return "mobile";
  if (isCompact) return "tablet";
  return "desktop";
}

/** matchMedia — тот же расчёт ширины, что и CSS @media (без «дёрганья» от скроллбара). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

export function useViewportState(): ViewportState {
  const isMobile = useMediaQuery(`(max-width: ${VIEWPORT_BREAKPOINTS.mobile}rem)`);
  const isCompact = useMediaQuery(`(max-width: ${VIEWPORT_BREAKPOINTS.tablet}rem)`);
  const isTablet = isCompact && !isMobile;
  const isDesktop = !isCompact;
  const mode = modeFromQueries(isMobile, isCompact);

  return { mode, isMobile, isTablet, isDesktop, isCompact };
}

/** @deprecated Prefer useViewportContext / useViewportOptional inside ViewportRoot. */
export function useViewport(): ViewportState {
  return useViewportState();
}
