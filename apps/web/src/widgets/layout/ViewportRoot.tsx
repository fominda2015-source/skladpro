import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useViewport, type ViewportMode } from "../../shared/hooks/useViewport";

type ViewportContextValue = ReturnType<typeof useViewport>;

const ViewportContext = createContext<ViewportContextValue | null>(null);

type Props = {
  children: ReactNode;
  /** Нижняя навигация — отступ у .canvas через body.hasBottomNav */
  bottomNav?: boolean;
};

export function ViewportRoot({ children, bottomNav = false }: Props) {
  const viewport = useViewport();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.viewport = viewport.mode;
    root.dataset.viewportWidth = String(viewport.width);
    return () => {
      delete root.dataset.viewport;
      delete root.dataset.viewportWidth;
    };
  }, [viewport.mode, viewport.width]);

  useEffect(() => {
    document.body.classList.toggle("hasBottomNav", bottomNav && viewport.isMobile);
    return () => {
      document.body.classList.remove("hasBottomNav");
    };
  }, [bottomNav, viewport.isMobile]);

  return <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>;
}

export function useViewportContext(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  if (!ctx) {
    throw new Error("useViewportContext must be used within ViewportRoot");
  }
  return ctx;
}

/** Без провайдера — только чтение (для ленивых виджетов). */
export function useViewportOptional(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  const fallback = useViewport();
  return ctx ?? fallback;
}

export function viewportModeLabel(mode: ViewportMode): string {
  if (mode === "mobile") return "телефон";
  if (mode === "tablet") return "планшет";
  return "десктоп";
}
