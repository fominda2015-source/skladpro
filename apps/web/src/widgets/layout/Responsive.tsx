import type { ReactNode } from "react";
import { useViewportOptional } from "./ViewportRoot";

type Props = { children: ReactNode };

/** Рендер только на телефоне (≤720px). Десктоп не затрагивается. */
export function MobileOnly({ children }: Props) {
  const { isMobile } = useViewportOptional();
  return isMobile ? <>{children}</> : null;
}

/** Рендер только на десктопе (>900px). */
export function DesktopOnly({ children }: Props) {
  const { isDesktop } = useViewportOptional();
  return isDesktop ? <>{children}</> : null;
}

/** Рендер на телефоне и планшете (≤900px). */
export function CompactOnly({ children }: Props) {
  const { isCompact } = useViewportOptional();
  return isCompact ? <>{children}</> : null;
}
