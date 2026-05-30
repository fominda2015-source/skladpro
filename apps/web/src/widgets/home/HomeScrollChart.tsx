import type { ReactNode } from "react";

type VerticalProps = {
  height: number;
  maxPreview?: number;
  children: ReactNode;
};

/** Вертикальная прокрутка — для горизонтальных bar-chart (layout=vertical). */
export function HomeScrollChart({ height, maxPreview = 280, children }: VerticalProps) {
  const preview = Math.min(maxPreview, height);
  const scrollable = height > maxPreview;
  return (
    <div className={`homeChartScroll${scrollable ? " is-scrollable" : ""}`} style={{ maxHeight: preview }}>
      <div className="homeChartScrollInner" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

type HorizontalProps = {
  width: number;
  height: number;
  maxPreviewHeight?: number;
  children: ReactNode;
};

/** Горизонтальная прокрутка — для столбчатых графиков с множеством объектов по оси X. */
export function HomeScrollChartX({ width, height, maxPreviewHeight = 280, children }: HorizontalProps) {
  return (
    <div className="homeChartScrollX is-scrollable" style={{ maxHeight: maxPreviewHeight }}>
      <div className="homeChartScrollInner" style={{ width, height, minWidth: "100%" }}>
        {children}
      </div>
    </div>
  );
}

export function chartRowsHeight(rowCount: number, rowHeight = 34, padding = 48, min = 160) {
  return Math.max(min, padding + rowCount * rowHeight);
}

export function chartColumnsWidth(columnCount: number, columnWidth = 52, padding = 80, min = 320) {
  return Math.max(min, padding + columnCount * columnWidth);
}
