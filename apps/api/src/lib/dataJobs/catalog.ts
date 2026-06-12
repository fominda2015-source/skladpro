import { backfillIssueResponsibleNames } from "../issueResponsibleBackfill.js";
import { rebuildAllPricing } from "../pricingRebuild.js";
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
  }
];

export function getDataRebuildJob(jobId: string): DataRebuildJob | undefined {
  return DATA_REBUILD_JOBS.find((j) => j.id === jobId);
}
