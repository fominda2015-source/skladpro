import { useState } from "react";

type Section = "stocks" | "limits" | "materialReport" | "tools" | "issues" | "receipts";

type Period = "day" | "week" | "month" | "year" | "custom";

type Props = {
  section: Section;
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  title?: string;
};

const PERIOD_LABELS: Array<{ id: Period; label: string }> = [
  { id: "day", label: "1 день" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "year", label: "Год" },
  { id: "custom", label: "Период…" }
];

// Кнопка-виджет «Скачать Excel за период».
// Период: 1 день / неделя / месяц / год / произвольный (с from/to, не более 366 дней).
export function PeriodExportButton({ section, token, apiUrl, fetchWithSession, title }: Props) {
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function downloadXlsx() {
    if (!token) return;
    setBusy(true);
    setErr("");
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
    try {
      const r = await fetchWithSession(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        setErr(text || `Ошибка ${r.status}`);
        return;
      }
      const blob = await r.blob();
      const disposition = r.headers.get("Content-Disposition") || "";
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const fileName = match ? decodeURIComponent(match[1]) : `${section}.xlsx`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        padding: 6,
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: 8,
        background: "var(--bgSoft, #fafafa)"
      }}
    >
      <span style={{ fontSize: 12, color: "var(--muted, #6b7280)" }}>
        {title || "Excel за период"}:
      </span>
      <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
        {PERIOD_LABELS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      {period === "custom" && (
        <>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ width: 130 }}
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ width: 130 }}
          />
        </>
      )}
      <button type="button" onClick={() => void downloadXlsx()} disabled={busy}>
        {busy ? "Готовим…" : "Скачать .xlsx"}
      </button>
      {err && (
        <span style={{ fontSize: 12, color: "#b54708" }} title={err}>
          {err.length > 60 ? err.slice(0, 60) + "…" : err}
        </span>
      )}
    </div>
  );
}
