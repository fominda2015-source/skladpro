export type ActTemplate = {
  id: string;
  label: string;
  fileName: string;
  description?: string;
};

/** Шаблоны актов — файлы лежат в /acts/ (public/acts). */
export const ACT_TEMPLATES: ActTemplate[] = [
  { id: "return", label: "Возврат", fileName: "Возврат.xlsx" },
  { id: "interunit", label: "Межподразделенческая", fileName: "Межподразделенческая.xlsx" },
  { id: "shortage", label: "Недостача", fileName: "Недостача.xlsx" },
  { id: "malfunction", label: "Неисправность", fileName: "Неисправность.xlsx" },
  { id: "damage", label: "Порча", fileName: "Порча.xlsx" },
  {
    id: "handover",
    label: "Приём-передача ТМЦ",
    fileName: "Прием-передача ТМЦ.xlsx",
    description: "Приём-передача товарно-материальных ценностей"
  },
  { id: "writeoff", label: "Списание", fileName: "Списание.xlsx" },
  { id: "loss", label: "Утеря", fileName: "Утеря.xlsx" },
  { id: "disposal", label: "Утилизация", fileName: "Утилизация.xlsx" },
  { id: "theft", label: "Хищение", fileName: "Хищение.xlsx" }
];

/** Скачивание через API (тот же origin, что и uploads). */
export function actDownloadUrl(fileName: string, apiUrl = ""): string {
  const base = apiUrl.replace(/\/$/, "");
  return `${base}/acts/${encodeURIComponent(fileName)}`;
}
