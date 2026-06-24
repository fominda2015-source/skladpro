import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_OBJECTS_ID } from "../../app/constants";
import { EmptyState, LoadingState, ResultBanner } from "../../shared/ui/StateViews";
import { PageHero } from "../ui/PageHero";
import { downloadApiExcel, formatRuDate, formatRuDateTime } from "./fieldDocUtils";

export type DailyAttendanceRow = {
  position: string;
  normQty: number;
  presentQty: number;
  nameReason: string;
};

export type DailyAttendanceBlock = {
  title: string;
  organization: string;
  rows: DailyAttendanceRow[];
};

type HistoryItem = {
  id: string;
  workDate: string;
  objectTitle: string;
  updatedAt: string;
  createdByName: string | null;
};

const ROW_LIMITS: Record<"SS" | "EOM", number[]> = {
  EOM: [3, 9],
  SS: [3, 4]
};

const EMPTY_ROW = (): DailyAttendanceRow => ({
  position: "",
  normQty: 1,
  presentQty: 0,
  nameReason: ""
});

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  warehouseId: string;
  section: "SS" | "EOM";
  warehouseName: string;
  canWrite: boolean;
};

export function DailyAttendanceTab({ token, apiUrl, fetchWithSession, warehouseId, section, warehouseName, canWrite }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "err">("ok");
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [objectTitle, setObjectTitle] = useState("");
  const [blocks, setBlocks] = useState<DailyAttendanceBlock[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");

  const limits = useMemo(() => ROW_LIMITS[section], [section]);
  const scopeParams = new URLSearchParams({ warehouseId, section });

  const loadHistory = useCallback(async () => {
    if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID) return;
    const q = new URLSearchParams({ warehouseId, section });
    if (historyFrom) q.set("dateFrom", historyFrom);
    if (historyTo) q.set("dateTo", historyTo);
    const res = await fetchWithSession(`${apiUrl}/api/daily-attendance?${q}`, {
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
      const res = await fetchWithSession(`${apiUrl}/api/daily-attendance/${workDate}?${scopeParams}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setObjectTitle(data.objectTitle || "");
      setBlocks((data.blocks as DailyAttendanceBlock[]) || []);
      await loadHistory();
    } catch (e) {
      setMessage(`Не удалось загрузить табель: ${String(e)}`);
      setMessageTone("err");
    } finally {
      setLoading(false);
    }
  }, [token, warehouseId, workDate, apiUrl, fetchWithSession, loadHistory, scopeParams]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  function updateBlock(blockIdx: number, patch: Partial<DailyAttendanceBlock>) {
    setBlocks((prev) => prev.map((b, i) => (i === blockIdx ? { ...b, ...patch } : b)));
  }

  function updateRow(blockIdx: number, rowIdx: number, patch: Partial<DailyAttendanceRow>) {
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIdx
          ? { ...b, rows: b.rows.map((r, j) => (j === rowIdx ? { ...r, ...patch } : r)) }
          : b
      )
    );
  }

  function addRow(blockIdx: number) {
    const max = limits[blockIdx] ?? 10;
    setBlocks((prev) =>
      prev.map((b, i) => (i === blockIdx && b.rows.length < max ? { ...b, rows: [...b.rows, EMPTY_ROW()] } : b))
    );
  }

  async function save() {
    if (!token || !canWrite) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/daily-attendance/${workDate}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId, section, objectTitle, blocks })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      setMessage("Табель учёта сохранён");
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
        `${apiUrl}/api/daily-attendance/${workDate}/export?${scopeParams}`,
        token,
        `Табель учета ${workDate}.xlsx`
      );
    } catch (e) {
      setMessage(String(e));
      setMessageTone("err");
    }
  }

  if (!warehouseId || warehouseId === ALL_OBJECTS_ID) {
    return <EmptyState title="Выберите объект" hint="Табель учёта формируется для конкретного объекта" />;
  }

  if (loading) return <LoadingState text="Загрузка табеля учёта…" />;

  return (
    <div className="fieldDocTab">
      <PageHero
        icon="▥"
        title="Табель учёта"
        subtitle={`Ежедневная расстановка · ${section}`}
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
        <span className="chip neutral">Дата в Excel подставится автоматически</span>
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
          Заголовок
          <textarea value={objectTitle} rows={2} disabled={!canWrite} onChange={(e) => setObjectTitle(e.target.value)} />
        </label>
      </section>

      {blocks.map((block, blockIdx) => (
        <section key={`da-block-${blockIdx}`} className="fieldDocPanel">
          <div className="fieldDocPanelHead">
            <input
              className="fieldDocBlockTitle"
              value={block.title}
              disabled={!canWrite}
              onChange={(e) => updateBlock(blockIdx, { title: e.target.value })}
            />
            {canWrite ? (
              <button
                type="button"
                className="btn ghost small"
                disabled={block.rows.length >= (limits[blockIdx] ?? 10)}
                onClick={() => addRow(blockIdx)}
              >
                + строка
              </button>
            ) : null}
          </div>
          <label>
            Организация
            <input
              value={block.organization}
              disabled={!canWrite}
              onChange={(e) => updateBlock(blockIdx, { organization: e.target.value })}
            />
          </label>
          <div className="fieldDocTableWrap" style={{ marginTop: 8 }}>
            <table className="fieldDocTable">
              <thead>
                <tr>
                  <th>Должность</th>
                  <th>Норма</th>
                  <th>Присутствие</th>
                  <th>ФИО / причины / меры</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIdx) => (
                  <tr key={`da-${blockIdx}-${rowIdx}`}>
                    <td>
                      <input
                        value={row.position}
                        disabled={!canWrite}
                        onChange={(e) => updateRow(blockIdx, rowIdx, { position: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={row.normQty}
                        disabled={!canWrite}
                        onChange={(e) => updateRow(blockIdx, rowIdx, { normQty: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={row.presentQty}
                        disabled={!canWrite}
                        onChange={(e) => updateRow(blockIdx, rowIdx, { presentQty: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <input
                        value={row.nameReason}
                        disabled={!canWrite}
                        onChange={(e) => updateRow(blockIdx, rowIdx, { nameReason: e.target.value })}
                      />
                    </td>
                    <td>
                      {canWrite && block.rows.length > 0 ? (
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() =>
                            updateBlock(blockIdx, { rows: block.rows.filter((_, j) => j !== rowIdx) })
                          }
                        >
                          ×
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

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
                  <td>{h.createdByName || "—"}</td>
                  <td className="muted">{formatRuDateTime(h.updatedAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() =>
                        void downloadApiExcel(
                          fetchWithSession,
                          `${apiUrl}/api/daily-attendance/${h.workDate}/export?${scopeParams}`,
                          token!,
                          `Табель ${h.workDate}.xlsx`
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
