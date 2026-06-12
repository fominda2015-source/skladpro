export type DataJobCategory = "pricing" | "issues" | "receipts" | "warehouse" | "tools" | "general";

export type DataJobRunStats = Record<string, unknown>;

export type DataRebuildJob = {
  id: string;
  title: string;
  description: string;
  category: DataJobCategory;
  /** Автозапуск на деплое, пока нет успешного run с этой версией. */
  deployVersion?: string;
  run: () => Promise<DataJobRunStats>;
};

export type DataJobRunStatus = "RUNNING" | "OK" | "FAIL";
