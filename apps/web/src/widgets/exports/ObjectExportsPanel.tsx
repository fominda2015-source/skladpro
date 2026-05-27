import { useState } from "react";
import { downloadExportXlsx, type ExportProgressState } from "../../shared/exportXlsx";
import { ExportProgressBar } from "./ExportProgressBar";

export type ExportSectionId =
  | "stocks"
  | "limits"
  | "materialReport"
  | "tools"
  | "issues"
  | "receipts";

const EXPORT_TYPES: Array<{
  id: ExportSectionId;
  label: string;
  permission: string;
}> = [
  { id: "stocks", label: "Склад (остатки и движения)", permission: "stocks.read" },
  { id: "limits", label: "Лимиты", permission: "limits.read" },
  { id: "materialReport", label: "Материальный отчёт", permission: "materialReport.read" },
  { id: "tools", label: "Инструменты", permission: "tools.read" },
  { id: "issues", label: "Заявки на выдачу", permission: "issues.read" },
  { id: "receipts", label: "Приходы", permission: "operations.read" }
];

type Period = "day" | "week" | "month" | "year" | "custom";

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  hasPermission: (p: string) => boolean;
  warehouseId?: string;
  section?: "SS" | "EOM"; // раздел СС/ЭОМ для фильтра экспорта
  warehouses?: Array<{ id: string; name: string }>;
  title?: string;
};

export function ObjectExportsPanel(props: Props) {
  const {
    token,
    apiUrl,
    fetchWithSession,
    hasPermission,
    warehouseId: fixedWarehouseId,
    section: sectionFilter = "SS",
    warehouses = [],
    title = "Выгрузка в Excel"
  } = props;

  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pickWarehouseId, setPickWarehouseId] = useState(fixedWarehouseId || "");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<ExportProgressState | null>(null);

  const warehouseId = fixedWarehouseId || pickWarehouseId;
  const allowed = EXPORT_TYPES.filter((t) => hasPermission(t.permission));

  async function downloadOne(section: ExportSectionId) {
    if (!token) return;
    setBusyId(section);
    setMessage("");
    setProgress(null);
    const url = new URL(`${apiUrl}/api/exports/${section}.xlsx`);
    if (period === "custom") {
      if (!from || !to) {
        setMessage("Укажите даты периода");
        setBusyId("");
        return;
      }
      url.searchParams.set("from", from);
      url.searchParams.set("to", to);
    } else {
      url.searchParams.set("period", period);
    }
    if (warehouseId) {
      url.searchParams.set("warehouseId", warehouseId);
      url.searchParams.set("section", sectionFilter === "EOM" ? "EOM" : "SS");
    }
    const result = await downloadExportXlsx(
      fetchWithSession,
      url.toString(),
      token,
      `${section}.xlsx`,
      setProgress
    );
    setBusyId("");
    if (!result.ok) {
      setMessage(result.error);
      setProgress(null);
      return;
    }
    setMessage("Файл скачан");
    setTimeout(() => setProgress(null), 2000);
  }

  if (!allowed.length) {
    return <p className="muted">Нет прав на экспорт данных в Excel.</p>;
  }

  return (
    <div className="card objectExportsPanel" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>{title}</h4>
      <div className="toolbar" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <label className="muted" style={{ fontSize: 13 }}>
          Период{" "}
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="day">1 день</option>
            <option value="week">Неделя</option>
            <option value="month">Месяц</option>
            <option value="year">Год</option>
            <option value="custom">Свой период</option>
          </select>
        </label>
        {period === "custom" ? (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        ) : null}
        {!fixedWarehouseId && warehouses.length > 0 ? (
          <label className="muted" style={{ fontSize: 13 }}>
            Объект{" "}
            <select value={pickWarehouseId} onChange={(e) => setPickWarehouseId(e.target.value)}>
              <option value="">Все объекты (в зоне доступа)</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="objectExportsGrid">
        {allowed.map((t) => (
          <button
            key={t.id}
            type="button"
            className="ghostBtn"
            disabled={Boolean(busyId)}
            onClick={() => void downloadOne(t.id)}
          >
            {busyId === t.id ? "Формируем…" : t.label}
          </button>
        ))}
      </div>
      {busyId ? (
        <ExportProgressBar
          progress={
            progress ?? {
              phase: "waiting",
              percent: null,
              elapsedSec: 0,
              detail: "Формирование отчёта на сервере…"
            }
          }
        />
      ) : null}
      {message ? (
        <p className="muted" style={{ margin: "10px 0 0", color: message.includes("скачан") ? "#16a34a" : "#b54708" }}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
