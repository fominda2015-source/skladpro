import { useState } from "react";
import { downloadExportXlsx, type ExportProgressState } from "../../shared/exportXlsx";
import { ExportProgressBar } from "./ExportProgressBar";

type Section = "stocks" | "limits" | "materialReport" | "tools" | "issues" | "receipts";

type Period = "day" | "week" | "month" | "year" | "custom";

type Props = {
  section: Section;
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  title?: string;
  warehouseId?: string;
  sectionFilter?: "SS" | "EOM";
};

const PERIOD_LABELS: Array<{ id: Period; label: string }> = [
  { id: "day", label: "1 день" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "year", label: "Год" },
  { id: "custom", label: "Период…" }
];

export function PeriodExportButton({
  section,
  token,
  apiUrl,
  fetchWithSession,
  title,
  warehouseId,
  sectionFilter
}: Props) {
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState<ExportProgressState | null>(null);

  async function downloadXlsx() {
    if (!token) return;
    setBusy(true);
    setErr("");
    setProgress(null);
    const url = new URL(`${apiUrl}/api/exports/${section}.xlsx`);
    if (period === "custom") {
      if (!from || !to) {
        setErr("Укажи обе даты");
        setBusy(false);
        return;
      }
      url.searchParams.set("from", from);
      url.searchParams.set("to", to);
    } else {
      url.searchParams.set("period", period);
    }
    if (warehouseId) {
      url.searchParams.set("warehouseId", warehouseId);
      if (sectionFilter) url.searchParams.set("section", sectionFilter);
    }
    const result = await downloadExportXlsx(
      fetchWithSession,
      url.toString(),
      token,
      `${section}.xlsx`,
      setProgress
    );
    if (!result.ok) setErr(result.error);
    setBusy(false);
    setTimeout(() => setProgress(null), result.ok ? 2000 : 0);
  }

  return (
    <div className="periodExportBtn">
      <span className="periodExportLabel">{title || "Excel за период"}:</span>
      <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
        {PERIOD_LABELS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {period === "custom" ? (
        <>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </>
      ) : null}
      <button type="button" onClick={() => void downloadXlsx()} disabled={busy}>
        {busy ? "Формируем…" : "Скачать .xlsx"}
      </button>
      {busy && progress ? <ExportProgressBar progress={progress} /> : null}
      {err ? (
        <span className="periodExportErr" title={err}>
          {err.length > 80 ? `${err.slice(0, 80)}…` : err}
        </span>
      ) : null}
    </div>
  );
}
