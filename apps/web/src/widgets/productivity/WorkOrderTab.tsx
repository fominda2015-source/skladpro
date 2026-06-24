import { useCallback, useEffect, useState } from "react";
import { ALL_OBJECTS_ID } from "../../app/constants";
import { EmptyState, LoadingState, ResultBanner } from "../../shared/ui/StateViews";
import { PageHero } from "../ui/PageHero";
import { downloadApiExcel, formatRuDate, formatRuDateTime } from "./fieldDocUtils";

export type WorkOrderRow = {
  place: string;
  workAssigned: string;
  peoplePlan?: number | string | null;
  peopleFact?: number | string | null;
  workDone?: string;
  status?: string;
  volumePlan?: string;
  volumeFact?: string;
  note?: string;
};

type HistoryItem = {
  id: string;
  workDate: string;
  objectTitle: string;
  foremanName: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
};

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  warehouseId: string;
  section: "SS" | "EOM";
  warehouseName: string;
  canWrite: boolean;
};

const EMPTY_ROW = (): WorkOrderRow => ({
  place: "",
  workAssigned: "",
  peoplePlan: "",
  peopleFact: "",
  workDone: "",
  status: "",
  volumePlan: "",
  volumeFact: "",
  note: ""
});

export function WorkOrderTab({ token, apiUrl, fetchWithSession, warehouseId, section, warehouseName, canWrite }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "err">("ok");
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [objectTitle, setObjectTitle] = useState("");
  const [foremanName, setForemanName] = useState("");
  const [responsibleItrName, setResponsibleItrName] = useState("");
  const [composedByItrName, setComposedByItrName] = useState("");
  const [rows, setRows] = useState<WorkOrderRow[]>([EMPTY_ROW()]);
  const [completedWorksNote, setCompletedWorksNote] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");

  const scopeQuery = `warehouseId=${encodeURIComponent(warehouseId)}&section=${encodeURIComponent(section)}`;

  const loadHistory = useCallback(async () => {
    if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID) return;
    const q = new URLSearchParams({ warehouseId, section });
    if (historyFrom) q.set("dateFrom", historyFrom);
    if (historyTo) q.set("dateTo", historyTo);
    const res = await fetchWithSession(`${apiUrl}/api/work-orders?${q}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setHistory((await res.json()) as HistoryItem[]);
  }, [token, warehouseId, section, historyFrom, historyTo, apiUrl, fetchWithSession]);

  const loadDay = useCallback(async () => {
    if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/work-orders/${workDate}?${scopeQuery}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setObjectTitle(data.objectTitle || "");
      setForemanName(data.foremanName || "");
      setResponsibleItrName(data.responsibleItrName || "");
      setComposedByItrName(data.composedByItrName || "");
      setRows((data.rows as WorkOrderRow[])?.length ? data.rows : [EMPTY_ROW()]);
      setCompletedWorksNote(data.completedWorksNote || "");
      if (!data.exists) {
        const ctxRes = await fetchWithSession(`${apiUrl}/api/work-orders/context?${scopeQuery}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (ctxRes.ok) {
          const ctx = await ctxRes.json();
          setResponsibleItrName(ctx.userShortName || "");
          setComposedByItrName(ctx.userShortName || "");
          if (!data.objectTitle) setObjectTitle(ctx.objectTitle || "");
        }
      }
    } catch (e) {
      setMessage(`Не удалось загрузить наряд-задание: ${String(e)}`);
      setMessageTone("err");
    } finally {
      setLoading(false);
    }
  }, [token, warehouseId, section, workDate, apiUrl, fetchWithSession, scopeQuery]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function save() {
    if (!token || !canWrite) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/work-orders/${workDate}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          section,
          objectTitle,
          foremanName,
          rows: rows.filter((r) => r.place.trim() || r.workAssigned.trim() || r.workDone?.trim()),
          completedWorksNote
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResponsibleItrName(data.responsibleItrName || responsibleItrName);
      setComposedByItrName(data.composedByItrName || composedByItrName);
      setMessage("Наряд-задание сохранено");
      setMessageTone("ok");
      await loadHistory();
    } catch (e) {
      setMessage(String(e));
      setMessageTone("err");
    } finally {
      setSaving(false);
    }
  }

  async function exportExcel() {
    if (!token) return;
    try {
      await downloadApiExcel(
        fetchWithSession,
        `${apiUrl}/api/work-orders/${workDate}/export?${scopeQuery}`,
        token,
        `Наряд задание ${workDate}.xlsx`
      );
    } catch (e) {
      setMessage(String(e));
      setMessageTone("err");
    }
  }

  if (!warehouseId || warehouseId === ALL_OBJECTS_ID) {
    return <EmptyState title="Выберите объект" hint="Наряд-задание формируется для конкретного объекта" />;
  }

  if (loading) return <LoadingState text="Загрузка наряд-задания…" />;

  return (
    <div className="fieldDocTab">
      <PageHero
        icon="📋"
        title="Наряд-задание"
        subtitle={`Ежедневный отчёт по работам · ${section}`}
        stats={[
          { label: "Дата", value: formatRuDate(workDate) },
          { label: "Объект", value: warehouseName || "—" }
        ]}
      />

      {message ? <ResultBanner text={message} tone={messageTone === "ok" ? "success" : "error"} /> : null}

      <div className="fieldDocToolbar">
        <label>
          Дата
          <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        </label>
        <div className="fieldDocAutoChips">
          <span className="chip neutral" title="Заполняется автоматически">
            ИТР: {responsibleItrName || "—"}
          </span>
          <span className="chip neutral" title="Заполняется автоматически">
            Составил: {composedByItrName || "—"}
          </span>
        </div>
        <div className="fieldDocActions">
          {canWrite ? (
            <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          ) : null}
          <button type="button" className="btn secondary" onClick={() => void exportExcel()}>
            Скачать Excel
          </button>
        </div>
      </div>

      <section className="fieldDocPanel">
        <label className="fieldDocWide">
          Заголовок объекта
          <textarea value={objectTitle} rows={2} disabled={!canWrite} onChange={(e) => setObjectTitle(e.target.value)} />
        </label>
        <label>
          Бригадир (ФИО)
          <input value={foremanName} disabled={!canWrite} onChange={(e) => setForemanName(e.target.value)} />
        </label>
      </section>

      <section className="fieldDocPanel">
        <div className="fieldDocPanelHead">
          <h3>Отчёт по работам</h3>
          {canWrite ? (
            <button
              type="button"
              className="btn ghost small"
              disabled={rows.length >= 6}
              onClick={() => setRows((prev) => [...prev, EMPTY_ROW()])}
            >
              + строка
            </button>
          ) : null}
        </div>
        <div className="fieldDocTableWrap">
          <table className="fieldDocTable">
            <thead>
              <tr>
                <th>Место работ</th>
                <th>Вид работ (задание)</th>
                <th>Чел. план</th>
                <th>Чел. факт</th>
                <th>Отработано</th>
                <th>Статус</th>
                <th>Объём план</th>
                <th>Объём факт</th>
                <th>Примечание</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`wo-row-${i}`}>
                  {(["place", "workAssigned", "peoplePlan", "peopleFact", "workDone", "status", "volumePlan", "volumeFact", "note"] as const).map(
                    (key) => (
                      <td key={key}>
                        <input
                          value={String(row[key] ?? "")}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r, j) => (j === i ? { ...r, [key]: e.target.value } : r))
                            )
                          }
                        />
                      </td>
                    )
                  )}
                  <td>
                    {canWrite && rows.length > 1 ? (
                      <button type="button" className="btn ghost small" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="fieldDocWide" style={{ marginTop: 12 }}>
          Выполненные работы
          <textarea
            value={completedWorksNote}
            rows={2}
            disabled={!canWrite}
            onChange={(e) => setCompletedWorksNote(e.target.value)}
          />
        </label>
      </section>

      <section className="fieldDocPanel">
        <h3 className="fieldDocPanelTitle">История</h3>
        <div className="fieldDocHistoryFilters">
          <label>
            С
            <input type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} />
          </label>
          <label>
            По
            <input type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} />
          </label>
          <button type="button" className="btn secondary small" onClick={() => void loadHistory()}>
            Найти
          </button>
        </div>
        {!history.length ? (
          <p className="muted">Записей пока нет</p>
        ) : (
          <table className="fieldDocHistoryTable">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Бригадир</th>
                <th>Кто сохранил</th>
                <th>Когда</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>
                    <button type="button" className="linkishBtn" onClick={() => setWorkDate(h.workDate)}>
                      {formatRuDate(h.workDate)}
                    </button>
                  </td>
                  <td>{h.foremanName || "—"}</td>
                  <td>{h.updatedByName || h.createdByName || "—"}</td>
                  <td className="muted">{formatRuDateTime(h.updatedAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() =>
                        void downloadApiExcel(
                          fetchWithSession,
                          `${apiUrl}/api/work-orders/${h.workDate}/export?${scopeQuery}`,
                          token!,
                          `Наряд ${h.workDate}.xlsx`
                        )
                      }
                    >
                      Excel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
