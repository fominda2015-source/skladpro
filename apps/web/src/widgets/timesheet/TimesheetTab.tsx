import { useCallback, useEffect, useRef, useState } from "react";
import { ALL_OBJECTS_ID } from "../../app/constants";
import { EmptyState, LoadingState, ResultBanner } from "../../shared/ui/StateViews";
import { PageHero } from "../ui/PageHero";
import { ResponsiveTableShell } from "../layout/MobileCardParts";
import { downloadApiExcel, formatRuDate, formatRuDateTime } from "../productivity/fieldDocUtils";

type EmployeeListItem = {
  id: string;
  fullName: string;
  position: string;
  hireDate: string;
  hasDraft: boolean;
  draftUpdatedAt: string | null;
};

type TimesheetContext = {
  organization: string;
  department: string;
  objectName: string;
  sheetLabel: string;
  month: string;
  compileDate: string;
  periodFrom: string;
  periodTo: string;
  periodLabel: string;
  responsibleTitle: string;
  responsibleName: string;
  responsibleFullName: string;
  days: string[];
  isClosed?: boolean;
};

type ArchiveItem = {
  id: string;
  month: string;
  closedAt: string;
  closedByName: string | null;
};

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  warehouseId: string;
  section: "SS" | "EOM";
  warehouseName: string;
};

function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(y, (m || 1) - 1, d || 1).getDay();
  return day === 0 || day === 6;
}

function weekdayShort(iso: string): string {
  const names = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const [y, m, d] = iso.split("-").map(Number);
  return names[new Date(y, (m || 1) - 1, d || 1).getDay()] ?? "";
}

function formatDayLabel(iso: string): string {
  const [, , d] = iso.split("-");
  return String(Number(d));
}

function defaultWorkMark(iso: string): string {
  return isWeekend(iso) ? "н" : "8";
}

export function TimesheetTab({ token, apiUrl, fetchWithSession, warehouseId, section, warehouseName }: Props) {
  const [view, setView] = useState<"editor" | "history">("editor");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "err">("ok");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [context, setContext] = useState<TimesheetContext | null>(null);
  const [organization, setOrganization] = useState("");
  const [department, setDepartment] = useState("");
  const [objectName, setObjectName] = useState("");
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [readOnly, setReadOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [archives, setArchives] = useState<ArchiveItem[]>([]);
  const loadedRef = useRef<string>("");

  const days = context?.days ?? [];
  const isClosed = context?.isClosed === true;

  const loadEmployees = useCallback(async () => {
    if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID) return;
    const params = new URLSearchParams({ warehouseId, section, month });
    const res = await fetchWithSession(`${apiUrl}/api/timesheet/employees?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { employees: EmployeeListItem[] };
    setEmployees(data.employees);
    setSelectedId((prev) => prev ?? data.employees[0]?.id ?? null);
  }, [token, warehouseId, section, month, apiUrl, fetchWithSession]);

  const loadContext = useCallback(async () => {
    if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID) {
      setContext(null);
      setEmployees([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ warehouseId, section, month });
      const res = await fetchWithSession(`${apiUrl}/api/timesheet/context?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TimesheetContext;
      setContext(data);
      setOrganization(data.organization);
      setDepartment(data.department);
      setObjectName(data.objectName);
      await loadEmployees();
      const archRes = await fetchWithSession(`${apiUrl}/api/timesheet/archives?${new URLSearchParams({ warehouseId, section })}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (archRes.ok) setArchives((await archRes.json()) as ArchiveItem[]);
    } catch (e) {
      setMessage(`Не удалось подготовить табель: ${String(e)}`);
      setMessageTone("err");
      setContext(null);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [token, warehouseId, section, month, apiUrl, fetchWithSession, loadEmployees]);

  const loadEmployeeDraft = useCallback(
    async (staffUserId: string) => {
      if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID) return;
      const params = new URLSearchParams({ warehouseId, section, month });
      const res = await fetchWithSession(`${apiUrl}/api/timesheet/draft/${staffUserId}?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFullName(data.fullName || "");
      setPosition(data.position || "");
      setHireDate(data.hireDate || "");
      setMarks((data.marks as Record<string, string>) || {});
      setReadOnly(Boolean(data.readOnly));
      setDirty(false);
      loadedRef.current = `${staffUserId}:${month}`;
    },
    [token, warehouseId, section, month, apiUrl, fetchWithSession]
  );

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (!selectedId) return;
    void loadEmployeeDraft(selectedId);
  }, [selectedId, loadEmployeeDraft]);

  async function pickEmployee(id: string) {
    if (dirty && selectedId && !window.confirm("Есть несохранённые изменения. Перейти без сохранения?")) return;
    setSelectedId(id);
  }

  async function saveEmployee() {
    if (!token || !selectedId || readOnly) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/timesheet/draft/${selectedId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          section,
          month,
          fullName,
          position,
          hireDate: hireDate || null,
          marks
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      setDirty(false);
      setMessage("Табель сотрудника сохранён");
      setMessageTone("ok");
      await loadEmployees();
    } catch (e) {
      setMessage(String(e));
      setMessageTone("err");
    } finally {
      setSaving(false);
    }
  }

  async function exportTimesheet() {
    if (!token || !context) return;
    setExportBusy(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/timesheet/export`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          section,
          month: context.month,
          organization: organization.trim(),
          department: department.trim(),
          objectName: objectName.trim()
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Табель ${context.month}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Табель сформирован и скачан");
      setMessageTone("ok");
    } catch (e) {
      setMessage(String(e));
      setMessageTone("err");
    } finally {
      setExportBusy(false);
    }
  }

  async function closeMonth() {
    if (!token || !context || isClosed) return;
    const unsaved = employees.filter((e) => !e.hasDraft);
    const warn =
      unsaved.length > 0
        ? `Не сохранено сотрудников: ${unsaved.length}. Они попадут в архив с отметками по умолчанию. Закрыть месяц?`
        : "Закрыть месяц? После закрытия правки будут недоступны.";
    if (!window.confirm(warn)) return;
    setCloseBusy(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/timesheet/close-month`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          section,
          month,
          organization: organization.trim(),
          department: department.trim(),
          objectName: objectName.trim()
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      setMessage("Месяц закрыт и сохранён в истории");
      setMessageTone("ok");
      await loadContext();
    } catch (e) {
      setMessage(String(e));
      setMessageTone("err");
    } finally {
      setCloseBusy(false);
    }
  }

  const periodSummary =
    context ? `${formatRuDate(context.periodFrom)} — ${formatRuDate(context.periodTo)}` : "";

  if (!warehouseId || warehouseId === ALL_OBJECTS_ID) {
    return <EmptyState title="Выберите объект" hint="Табель формируется для конкретного объекта склада" />;
  }

  if (loading) return <LoadingState text="Подготовка табеля…" />;

  return (
    <div className="timesheetTab">
      <PageHero
        icon="▤"
        title="Табель"
        subtitle={`Учёт рабочего времени · ${section}`}
        stats={[
          { label: "Сотрудников", value: employees.length },
          { label: "Дней в периоде", value: days.length },
          { label: "Объект", value: warehouseName || "—" }
        ]}
      />

      {message ? <ResultBanner text={message} tone={messageTone === "ok" ? "success" : "error"} /> : null}

      <nav className="productivitySubTabs" aria-label="Режим табеля">
        <button type="button" className={view === "editor" ? "active" : ""} onClick={() => setView("editor")}>
          Заполнение
        </button>
        <button type="button" className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
          История
        </button>
      </nav>

      {view === "history" ? (
        <section className="fieldDocPanel">
          <h3 className="fieldDocPanelTitle">Закрытые месяцы</h3>
          {!archives.length ? (
            <p className="muted">Архив пуст</p>
          ) : (
            <table className="fieldDocHistoryTable">
              <thead>
                <tr>
                  <th>Месяц</th>
                  <th>Закрыл</th>
                  <th>Когда</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {archives.map((a) => (
                  <tr key={a.id}>
                    <td>{a.month}</td>
                    <td>{a.closedByName || "—"}</td>
                    <td className="muted">{formatRuDateTime(a.closedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() =>
                          void downloadApiExcel(
                            fetchWithSession,
                            `${apiUrl}/api/timesheet/archives/${a.month}/export?${new URLSearchParams({ warehouseId, section })}`,
                            token!,
                            `Табель ${a.month}.xlsx`
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
      ) : (
        <>
          <div className="timesheetLayout">
            <section className="timesheetPanel">
              <h3 className="timesheetPanelTitle">Реквизиты табеля</h3>
              <div className="timesheetFormGrid">
                <label>
                  <span>Организация</span>
                  <input value={organization} disabled={isClosed} onChange={(e) => setOrganization(e.target.value)} />
                </label>
                <label>
                  <span>Структурное подразделение</span>
                  <input value={department} disabled={isClosed} onChange={(e) => setDepartment(e.target.value)} />
                </label>
                <label className="timesheetFormGrid--wide">
                  <span>Объект</span>
                  <input value={objectName} disabled={isClosed} onChange={(e) => setObjectName(e.target.value)} />
                </label>
                <label>
                  <span>Отчётный месяц</span>
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
                </label>
              </div>
            </section>

            <section className="timesheetPanel timesheetAutoCard">
              <h3 className="timesheetPanelTitle">Автоматически</h3>
              <dl className="timesheetAutoList">
                <div>
                  <dt>Дата составления</dt>
                  <dd>{context ? formatRuDate(context.compileDate) : "—"}</dd>
                </div>
                <div>
                  <dt>Отчётный период</dt>
                  <dd>{periodSummary || "—"}</dd>
                </div>
                <div>
                  <dt>Ответственный</dt>
                  <dd>{context?.responsibleFullName || "—"}</dd>
                </div>
                <div>
                  <dt>Статус месяца</dt>
                  <dd>{isClosed ? "Закрыт" : "Открыт"}</dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="timesheetPanel timesheetPanel--actions">
            <div className="timesheetActions">
              {!isClosed ? (
                <button type="button" className="btn primary" disabled={closeBusy} onClick={() => void closeMonth()}>
                  {closeBusy ? "Закрытие…" : "Закрыть месяц"}
                </button>
              ) : null}
              <button type="button" className="btn secondary" disabled={exportBusy} onClick={() => void exportTimesheet()}>
                {exportBusy ? "Формирование…" : "Скачать Excel"}
              </button>
            </div>
          </section>

          <div className="timesheetEmployeeLayout">
            <aside className="timesheetEmployeeList">
              <h3>Сотрудники</h3>
              <ul>
                {employees.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      className={selectedId === e.id ? "active" : ""}
                      onClick={() => void pickEmployee(e.id)}
                    >
                      <span className="timesheetEmployeeName">{e.fullName}</span>
                      <span className={`timesheetDraftBadge ${e.hasDraft ? "saved" : "pending"}`}>
                        {e.hasDraft ? "сохранён" : "не сохранён"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="timesheetEmployeeEditor">
              {!selectedId ? (
                <EmptyState title="Выберите сотрудника" />
              ) : (
                <>
                  <div className="timesheetEmployeeHeader">
                    <label>
                      ФИО
                      <input
                        value={fullName}
                        disabled={readOnly}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          setDirty(true);
                        }}
                      />
                    </label>
                    <label>
                      Должность
                      <input
                        value={position}
                        disabled={readOnly}
                        onChange={(e) => {
                          setPosition(e.target.value);
                          setDirty(true);
                        }}
                      />
                    </label>
                    <label>
                      Дата приёма
                      <input
                        type="date"
                        value={hireDate}
                        disabled={readOnly}
                        onChange={(e) => {
                          setHireDate(e.target.value);
                          setDirty(true);
                        }}
                      />
                    </label>
                    {!readOnly ? (
                      <button type="button" className="btn primary" disabled={saving} onClick={() => void saveEmployee()}>
                        {saving ? "Сохранение…" : "Сохранить"}
                      </button>
                    ) : (
                      <span className="chip neutral">Месяц закрыт — только просмотр</span>
                    )}
                  </div>

                  <div className="timesheetTableCard">
                    <ResponsiveTableShell className="timesheetTableWrap">
                      <table className="timesheetTable timesheetTable--single">
                        <thead>
                          <tr>
                            {days.map((iso) => (
                              <th
                                key={iso}
                                className={isWeekend(iso) ? "timesheetDayCol--weekend" : ""}
                                title={iso}
                              >
                                <span className="timesheetDayNum">{formatDayLabel(iso)}</span>
                                <span className="timesheetDayWd">{weekdayShort(iso)}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            {days.map((iso) => (
                              <td key={iso} className={isWeekend(iso) ? "timesheetDayCol--weekend" : ""}>
                                <input
                                  className="timesheetMarkInput"
                                  value={marks[iso] ?? defaultWorkMark(iso)}
                                  disabled={readOnly}
                                  onChange={(e) => {
                                    setMarks((prev) => ({ ...prev, [iso]: e.target.value }));
                                    setDirty(true);
                                  }}
                                />
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </ResponsiveTableShell>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
