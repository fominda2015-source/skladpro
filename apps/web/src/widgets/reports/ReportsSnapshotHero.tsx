import type { ReactNode } from "react";
import { PageHero } from "../ui/PageHero";

type SnapshotCounts = {
  stockLines: number;
  totalStockQty: number;
  issuesTotal: number;
  waybillsOpen: number;
  tools: number;
  campItems: number;
  receiptRequests: { total: number };
  limitTemplates: number;
  linkedProjects: number;
};

type Props = {
  warehouseName: string;
  generatedAt: string;
  counts: SnapshotCounts | null;
  children?: ReactNode;
};

export function ReportsSnapshotHero({ warehouseName, generatedAt, counts, children }: Props) {
  return (
    <>
      <PageHero
        icon="📄"
        title="Сводка по объекту"
        subtitle={warehouseName ? `${warehouseName} · аналитика руководителя` : "Выберите объект для отчёта"}
        stats={
          counts
            ? [
                { label: "Остатки", value: counts.stockLines, tone: "neutral" },
                { label: "Выдачи", value: counts.issuesTotal, tone: "neutral" },
                { label: "ТН открыто", value: counts.waybillsOpen, tone: counts.waybillsOpen > 0 ? "warn" : "ok" },
                { label: "Инструменты", value: counts.tools, tone: "ok" },
                { label: "Приходы", value: counts.receiptRequests.total, tone: "neutral" },
                { label: "Лимиты", value: counts.limitTemplates, tone: "neutral" }
              ]
            : undefined
        }
      />
      {counts ? (
        <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
          Сформировано: {new Date(generatedAt).toLocaleString()} · количество на складе:{" "}
          {counts.totalStockQty.toFixed(2)} · городок: {counts.campItems} · проектов: {counts.linkedProjects}
        </p>
      ) : null}
      {children ? <div className="erpQuickActions">{children}</div> : null}
    </>
  );
}
