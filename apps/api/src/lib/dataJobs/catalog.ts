import { backfillIssueResponsibleNames } from "../issueResponsibleBackfill.js";
import { rebuildAllPricing } from "../pricingRebuild.js";
import { repairOrphanedSectionScopes } from "../objectAccess.js";
import { reconcileReceiptWarehouseStock } from "../receiptStockReconcile.js";
import type { DataRebuildJob } from "./types.js";

export const DATA_JOB_CATEGORY_LABELS: Record<DataRebuildJob["category"], string> = {
  pricing: "Цены и суммы",
  issues: "Заявки и выдачи",
  receipts: "Приходы",
  warehouse: "Склад",
  tools: "Инструменты и СИЗ",
  general: "Общее"
};

/** Каталог задач переформирования. При смене правил — новый deployVersion или принудительный запуск из админки. */
export const DATA_REBUILD_JOBS: DataRebuildJob[] = [
  {
    id: "rebuild.pricing",
    title: "Пересчёт цен материалов и инструментов",
    description:
      "Материалы: сумма за кол-во из прихода; старые карточки — из ₽/ед. × остаток. Инструменты/СИЗ: стоимость из прихода.",
    category: "pricing",
    deployVersion: "20260615_v1",
    run: async () => rebuildAllPricing()
  },
  {
    id: "backfill.issue-responsible",
    title: "Ответственный в заявках из примечания",
    description:
      "Заполняет поле «Ответственный» в выданных заявках из текста «Ответственный: …» в note. Безопасно повторять.",
    category: "issues",
    run: async () => backfillIssueResponsibleNames()
  },
  {
    id: "repair.orphan-section-scopes",
    title: "Починка доступов: раздел без привязки к объекту",
    description:
      "Для каждой записи доступа к разделу СС/ЭОМ без участия в объекте добавляет привязку к складу. Безопасно повторять.",
    category: "warehouse",
    deployVersion: "20260602_access_v1",
    run: async () => {
      const { repaired } = await repairOrphanedSectionScopes();
      return { repaired };
    }
  },
  {
    id: "reconcile.receipt-stock",
    title: "Восстановить остатки по принятым заявкам",
    description:
      "Создаёт недостающие остатки на складе по позициям с acceptedQty > 0, если приход на склад не был оформлен. Безопасно повторять.",
    category: "receipts",
    deployVersion: "20260602_receipt_stock_v1",
    run: async () => reconcileReceiptWarehouseStock()
  }
];

export function getDataRebuildJob(jobId: string): DataRebuildJob | undefined {
  return DATA_REBUILD_JOBS.find((j) => j.id === jobId);
}
