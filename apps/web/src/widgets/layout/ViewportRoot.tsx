import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useViewportState, type ViewportMode, type ViewportState } from "../../shared/hooks/useViewport";

const ViewportContext = createContext<ViewportState | null>(null);

type Props = {
  children: ReactNode;
  /** Нижняя навигация — отступ у .canvas через body.hasBottomNav */
  bottomNav?: boolean;
};

export function ViewportRoot({ children, bottomNav = false }: Props) {
  const viewport = useViewportState();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.viewport = viewport.mode;
    root.dataset.compact = viewport.isCompact ? "1" : "0";
    root.dataset.mobile = viewport.isMobile ? "1" : "0";
    return () => {
      delete root.dataset.viewport;
      delete root.dataset.compact;
      delete root.dataset.mobile;
    };
  }, [viewport.mode, viewport.isCompact, viewport.isMobile]);

  useEffect(() => {
    document.body.classList.toggle("hasBottomNav", bottomNav && viewport.isMobile);
    return () => {
      document.body.classList.remove("hasBottomNav");
    };
  }, [bottomNav, viewport.isMobile]);

  return <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>;
}

export function useViewportContext(): ViewportState {
  const ctx = useContext(ViewportContext);
  if (!ctx) {
    throw new Error("useViewportContext must be used within ViewportRoot");
  }
  return ctx;
}

/** Без провайдера — свой matchMedia (для Storybook/тестов). В приложении — из контекста. */
export function useViewportOptional(): ViewportState {
  const ctx = useContext(ViewportContext);
  const fallback = useViewportState();
  return ctx ?? fallback;
}

export function viewportModeLabel(mode: ViewportMode): string {
  if (mode === "mobile") return "телефон";
  if (mode === "tablet") return "планшет";
  return "десктоп";
}
