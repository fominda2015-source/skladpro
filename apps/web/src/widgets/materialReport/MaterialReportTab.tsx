import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useViewportContext } from "../layout/ViewportRoot";
import { EmptyState, LoadingState, ResultBanner } from "../../shared/ui/StateViews";
import { PageHero } from "../ui/PageHero";
import { UserAvatar } from "../chat/UserAvatar";
import { MaterialReportWriteoffModal, type WriteoffLine } from "./MaterialReportWriteoffModal";

export type MaterialReportHolder = {
  holderKey: string;
  holderUserId?: string | null;
  holderName: string;
  isWarehouseBalance?: boolean;
  issueNumbers?: string[];
  lastIssueAt?: string | null;
  lines: Array<{ materialId: string; name: string; unit: string; quantity: number }>;
};

export type MaterialWriteoffHistoryRow = {
  id: string;
  createdAt: string;
  quantity: number;
  comment?: string | null;
  holderKey?: string;
  holderName: string;
  actorName: string;
  materialName: string;
  materialUnit: string;
  documentFileId?: string | null;
  documentPath?: string | null;
  documentFileName?: string | null;
};

type SubTab = "balances" | "history";

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  warehouseId: string;
  section: "SS" | "EOM";
  canWriteoff: boolean;
  safeName: (s: string) => string;
  objectFilter: ReactNode;
  exportAction?: ReactNode;
};

function lineKey(holderKey: string, materialId: string) {
  return `${holderKey}:${materialId}`;
}

function formatQty(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU");
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ru-RU");
}

export function MaterialReportTab({
  token,
  apiUrl,
  fetchWithSession,
  warehouseId,
  section,
  canWriteoff,
  safeName,
  objectFilter,
  exportAction
}: Props) {
  const { isMobile } = useViewportContext();
  const [subTab, setSubTab] = useState<SubTab>("balances");
  const [holders, setHolders] = useState<MaterialReportHolder[]>([]);
  const [history, setHistory] = useState<MaterialWriteoffHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedHolderKey, setSelectedHolderKey] = useState("");
  const [holderSearch, setHolderSearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [issueSearch, setIssueSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | "warehouse" | "responsible">("");
  const [historySearch, setHistorySearch] = useState("");
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [writeoffOpen, setWriteoffOpen] = useState(false);

  const loadBalances = useCallback(async () => {
    if (!token || !warehouseId) return;
    const params = new URLSearchParams({ warehouseId, section });
    const res = await fetchWithSession(`${apiUrl}/api/material-report/balances?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(typeof err.error === "string" ? err.error : `Ошибка ${res.status}`);
    }
    setHolders((await res.json()) as MaterialReportHolder[]);
  }, [token, apiUrl, fetchWithSession, warehouseId, section]);

  const loadHistory = useCallback(async () => {
    if (!token || !warehouseId) return;
    const params = new URLSearchParams({ warehouseId, section, take: "500" });
    if (historySearch.trim()) params.set("q", historySearch.trim());
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (selectedHolderKey && subTab === "history") params.set("holderKey", selectedHolderKey);
    const res = await fetchWithSession(`${apiUrl}/api/material-report/writeoffs/history?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(typeof err.error === "string" ? err.error : `Ошибка ${res.status}`);
    }
    setHistory((await res.json()) as MaterialWriteoffHistoryRow[]);
  }, [token, apiUrl, fetchWithSession, warehouseId, section, historySearch, dateFrom, dateTo, selectedHolderKey, subTab]);

  const reload = useCallback(async () => {
    if (!token || !warehouseId) return;
    setLoading(true);
    setMessage("");
    try {
      await loadBalances();
      await loadHistory();
    } catch (e) {
      setMessage(String(e));
      setHolders([]);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [token, warehouseId, loadBalances, loadHistory]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (subTab === "history") void loadHistory();
  }, [subTab, loadHistory]);

  const filteredHolders = useMemo(() => {
    const q = holderSearch.trim().toLowerCase();
    const issueQ = issueSearch.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;

    return holders.filter((h) => {
      if (kindFilter === "warehouse" && !h.isWarehouseBalance) return false;
      if (kindFilter === "responsible" && h.isWarehouseBalance) return false;
      if (q && !h.holderName.toLowerCase().includes(q)) return false;
      if (issueQ && !(h.issueNumbers || []).some((n) => n.toLowerCase().includes(issueQ))) return false;
      if (fromTs || toTs) {
        const at = h.lastIssueAt ? new Date(h.lastIssueAt).getTime() : null;
        if (!at) return h.isWarehouseBalance;
        if (fromTs && at < fromTs) return false;
        if (toTs && at > toTs) return false;
      }
      return h.lines.length > 0;
    });
  }, [holders, holderSearch, issueSearch, dateFrom, dateTo, kindFilter]);

  useEffect(() => {
    if (!filteredHolders.length) {
      setSelectedHolderKey("");
      return;
    }
    if (!filteredHolders.some((h) => h.holderKey === selectedHolderKey)) {
      setSelectedHolderKey(filteredHolders[0]!.holderKey);
    }
  }, [filteredHolders, selectedHolderKey]);

  const selectedHolder = useMemo(
    () => filteredHolders.find((h) => h.holderKey === selectedHolderKey) ?? null,
    [filteredHolders, selectedHolderKey]
  );

  const visibleLines = useMemo(() => {
    if (!selectedHolder) return [];
    const q = materialSearch.trim().toLowerCase();
    if (!q) return selectedHolder.lines;
    return selectedHolder.lines.filter((ln) => ln.name.toLowerCase().includes(q));
  }, [selectedHolder, materialSearch]);

  const historyByHolder = useMemo(() => {
    const map = new Map<string, MaterialWriteoffHistoryRow[]>();
    for (const row of history) {
      const key = row.holderKey || row.holderName;
      const arr = map.get(key) || [];
      arr.push(row);
      map.set(key, arr);
    }
    return [...map.entries()]
      .map(([key, rows]) => ({
        key,
        holderName: rows[0]?.holderName || key,
        rows: rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        totalQty: rows.reduce((n, r) => n + Number(r.quantity), 0)
      }))
      .sort((a, b) => a.holderName.localeCompare(b.holderName, "ru"));
  }, [history]);

  const historySidebar = useMemo(() => {
    const q = holderSearch.trim().toLowerCase();
    return historyByHolder.filter((g) => !q || g.holderName.toLowerCase().includes(q));
  }, [historyByHolder, holderSearch]);

  const checkedLines = useMemo(() => {
    if (!selectedHolder || subTab !== "balances") return [] as WriteoffLine[];
    return visibleLines
      .filter((ln) => checked[lineKey(selectedHolder.holderKey, ln.materialId)])
      .map((ln) => ({
        holderKey: selectedHolder.holderKey,
        materialId: ln.materialId,
        name: ln.name,
        unit: ln.unit,
        maxQty: Number(ln.quantity) || 0
      }));
  }, [selectedHolder, visibleLines, checked, subTab]);

  const showThread = Boolean(selectedHolderKey && (subTab === "balances" ? selectedHolder : true));
  const showList = !isMobile || !showThread;

  const posCount = holders.reduce((n, h) => n + h.lines.length, 0);

  return (
    <div className={`materialReportPage chatPage ${isMobile && showThread ? "chatPage--thread" : ""}`}>
      {objectFilter ? <div className="materialReportObjectFilter">{objectFilter}</div> : null}
      <PageHero
        variant="compact"
        icon="▪"
        title="Материальный отчёт"
        subtitle={`Подотчёт · раздел ${section === "SS" ? "СС" : "ЭОМ"}`}
        stats={[
          { label: "Ответственных", value: holders.length, tone: "neutral" },
          { label: "Позиций", value: posCount, tone: posCount > 0 ? "ok" : "neutral" }
        ]}
        actions={
          <>
            <button type="button" className="ghostBtn" disabled={!warehouseId || loading} onClick={() => void reload()}>
              ↻ Обновить
            </button>
            {exportAction}
          </>
        }
      />

      <nav className="materialReportSubNav" aria-label="Разделы материального отчёта">
        <button type="button" className={subTab === "balances" ? "active" : ""} onClick={() => setSubTab("balances")}>
          Подотчёт
        </button>
        <button type="button" className={subTab === "history" ? "active" : ""} onClick={() => setSubTab("history")}>
          История списаний
        </button>
      </nav>

      {message ? (
        <ResultBanner text={message} tone={/ошиб|403|502|недостат/i.test(message) ? "error" : "neutral"} />
      ) : null}

      {!warehouseId ? (
        <p className="muted">Выберите объект в верхней панели.</p>
      ) : loading && !holders.length ? (
        <LoadingState text="Загрузка материального отчёта…" />
      ) : (
        <div className="chatLayout materialReportLayout">
          {showList ? (
            <aside className="chatSidebar materialReportSidebar" aria-label="Ответственные">
              <div className="chatSidebarSearch">
                <input
                  type="search"
                  value={holderSearch}
                  onChange={(e) => setHolderSearch(e.target.value)}
                  placeholder="Поиск по ФИО…"
                  aria-label="Поиск ответственного"
                />
              </div>
              {subTab === "balances" ? (
                <div className="materialReportSidebarFilters">
                  <input
                    type="search"
                    value={issueSearch}
                    onChange={(e) => setIssueSearch(e.target.value)}
                    placeholder="№ выдачи…"
                    aria-label="Фильтр по выдаче"
                  />
                  <div className="materialReportFilterRow">
                    <label>
                      с
                      <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                    </label>
                    <label>
                      по
                      <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                    </label>
                  </div>
                  <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} aria-label="Тип">
                    <option value="">Все</option>
                    <option value="warehouse">Склад (кладовщик)</option>
                    <option value="responsible">Ответственные</option>
                  </select>
                </div>
              ) : (
                <div className="materialReportSidebarFilters">
                  <input
                    type="search"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Материал, комментарий…"
                    aria-label="Поиск в истории"
                  />
                  <div className="materialReportFilterRow">
                    <label>
                      с
                      <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                    </label>
                    <label>
                      по
                      <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                    </label>
                  </div>
                  <button type="button" className="ghostBtn" onClick={() => void loadHistory()}>
                    Применить фильтры
                  </button>
                </div>
              )}

              <div className="chatSidebarSection chatSidebarSectionGrow">
                <span className="chatSidebarSectionTitle">
                  {subTab === "balances" ? "Ответственные" : "Списания по людям"}
                </span>
                {!filteredHolders.length && subTab === "balances" ? (
                  <p className="chatSidebarEmpty muted">Никого не найдено</p>
                ) : null}
                <ul className="chatContactList">
                  {subTab === "balances"
                    ? filteredHolders.map((h) => {
                        const active = h.holderKey === selectedHolderKey;
                        const preview =
                          h.lines.length === 1
                            ? `${safeName(h.lines[0]!.name)} · ${formatQty(Number(h.lines[0]!.quantity))}`
                            : `${h.lines.length} поз. · ${formatQty(h.lines.reduce((n, x) => n + Number(x.quantity), 0))} всего`;
                        return (
                          <li key={h.holderKey}>
                            <div
                              className={`chatContact ${active ? "active" : ""}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedHolderKey(h.holderKey)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedHolderKey(h.holderKey);
                                }
                              }}
                            >
                              <UserAvatar fullName={h.holderName} />
                              <span className="chatContactBody">
                                <span className="chatContactTop">
                                  <strong>{safeName(h.holderName)}</strong>
                                  <time>{formatDate(h.lastIssueAt)}</time>
                                </span>
                                <span className="chatContactPreview">
                                  {h.isWarehouseBalance ? "склад · " : ""}
                                  {preview}
                                </span>
                              </span>
                            </div>
                          </li>
                        );
                      })
                    : historySidebar.map((g) => {
                        const active = g.key === selectedHolderKey;
                        return (
                          <li key={g.key}>
                            <div
                              className={`chatContact ${active ? "active" : ""}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedHolderKey(g.key)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedHolderKey(g.key);
                                }
                              }}
                            >
                              <UserAvatar fullName={g.holderName} />
                              <span className="chatContactBody">
                                <span className="chatContactTop">
                                  <strong>{safeName(g.holderName)}</strong>
                                  <time>{g.rows[0] ? formatDate(g.rows[0].createdAt) : "—"}</time>
                                </span>
                                <span className="chatContactPreview muted">
                                  {g.rows.length} списан. · {formatQty(g.totalQty)} всего
                                </span>
                              </span>
                            </div>
                          </li>
                        );
                      })}
                </ul>
              </div>
            </aside>
          ) : null}

          <section className={`chatThread materialReportThread ${showThread ? "" : "chatThread--placeholder"}`}>
            {subTab === "balances" ? (
              showThread && selectedHolder ? (
                <>
                  <header className="chatThreadHead">
                    {isMobile ? (
                      <button type="button" className="ghostBtn chatBackBtn" onClick={() => setSelectedHolderKey("")}>
                        ←
                      </button>
                    ) : null}
                    <UserAvatar fullName={selectedHolder.holderName} size="md" />
                    <div className="chatThreadHeadText">
                      <strong>{safeName(selectedHolder.holderName)}</strong>
                      <span className="muted">
                        {selectedHolder.isWarehouseBalance ? "остаток на складе" : "материалы на руках"} ·{" "}
                        {selectedHolder.lines.length} поз.
                        {(selectedHolder.issueNumbers?.length ?? 0) > 0
                          ? ` · выдачи: ${selectedHolder.issueNumbers!.slice(0, 3).join(", ")}`
                          : ""}
                      </span>
                    </div>
                  </header>

                  <div className="materialReportThreadToolbar">
                    <input
                      type="search"
                      value={materialSearch}
                      onChange={(e) => setMaterialSearch(e.target.value)}
                      placeholder="Поиск материала…"
                      aria-label="Поиск материала"
                    />
                    {canWriteoff ? (
                      <button
                        type="button"
                        className="primaryBtn"
                        disabled={checkedLines.length === 0}
                        onClick={() => setWriteoffOpen(true)}
                      >
                        Списать ({checkedLines.length})
                      </button>
                    ) : null}
                  </div>

                  <div className="chatThreadMessages materialReportMessages">
                    {!visibleLines.length ? (
                      <EmptyState title="Нет позиций" hint="Измените фильтры или выберите другого ответственного." />
                    ) : (
                      visibleLines.map((ln) => {
                        const key = lineKey(selectedHolder.holderKey, ln.materialId);
                        const isChecked = Boolean(checked[key]);
                        return (
                          <div
                            key={key}
                            className={`chatBubble theirs materialReportBubble ${isChecked ? "selected" : ""}`}
                          >
                            {canWriteoff ? (
                              <label className="materialReportBubbleCheck">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) =>
                                    setChecked((prev) => ({ ...prev, [key]: e.target.checked }))
                                  }
                                />
                              </label>
                            ) : null}
                            <div className="materialReportBubbleBody">
                              <p className="chatBubbleText">{safeName(ln.name)}</p>
                              <span className="chatBubbleTime materialReportBubbleQty">
                                {formatQty(Number(ln.quantity))} {ln.unit}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              ) : (
                <div className="chatThreadEmpty muted">Выберите ответственного слева</div>
              )
            ) : showThread ? (
              <>
                <header className="chatThreadHead">
                  {isMobile ? (
                    <button type="button" className="ghostBtn chatBackBtn" onClick={() => setSelectedHolderKey("")}>
                      ←
                    </button>
                  ) : null}
                  <div className="chatThreadHeadText">
                    <strong>История списаний</strong>
                    <span className="muted">{history.length} записей · группировка как в лимитах</span>
                  </div>
                </header>

                <div className="chatThreadMessages materialReportHistoryPane">
                  {!historyByHolder.length ? (
                    <EmptyState title="Списаний нет" hint="За выбранный период записей не найдено." />
                  ) : (
                    <div className="plainList limitTree">
                      {(selectedHolderKey
                        ? historyByHolder.filter((g) => g.key === selectedHolderKey)
                        : historyByHolder
                      ).map((group) => {
                        const open = expandedHistory[group.key] ?? selectedHolderKey === group.key;
                        return (
                          <div key={group.key} className="limitTreeNode materialReportHistoryGroup">
                            <button
                              type="button"
                              className="materialReportHistoryGroupHead"
                              onClick={() =>
                                setExpandedHistory((prev) => ({ ...prev, [group.key]: !open }))
                              }
                            >
                              <span className="materialReportHistoryChevron">{open ? "▾" : "▸"}</span>
                              <strong>{safeName(group.holderName)}</strong>
                              <span className="muted">
                                {group.rows.length} списан. · {formatQty(group.totalQty)}
                              </span>
                            </button>
                            {open ? (
                              <div className="materialReportHistoryChildren">
                                {group.rows.map((row) => (
                                  <div key={row.id} className="materialReportHistoryRow">
                                    <div className="materialReportHistoryRowMain">
                                      <time>{formatDateTime(row.createdAt)}</time>
                                      <strong>{safeName(row.materialName)}</strong>
                                      <span>
                                        {formatQty(Number(row.quantity))} {row.materialUnit}
                                      </span>
                                    </div>
                                    <div className="muted materialReportHistoryRowMeta">
                                      Исполнитель: {safeName(row.actorName)}
                                      {row.comment ? ` · ${row.comment}` : ""}
                                    </div>
                                    {row.documentPath ? (
                                      <a href={`${apiUrl}/${row.documentPath}`} target="_blank" rel="noreferrer">
                                        {safeName(row.documentFileName || "Документ")}
                                      </a>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="chatThreadEmpty muted">Выберите ответственного слева</div>
            )}
          </section>
        </div>
      )}

      {writeoffOpen && checkedLines.length > 0 ? (
        <MaterialReportWriteoffModal
          lines={checkedLines}
          token={token}
          apiUrl={apiUrl}
          warehouseId={warehouseId}
          section={section}
          fetchWithSession={fetchWithSession}
          onClose={() => setWriteoffOpen(false)}
          onDone={async () => {
            setChecked({});
            setMessage("Списание выполнено.");
            await reload();
          }}
          onError={(msg) => setMessage(msg)}
          safeName={safeName}
        />
      ) : null}
    </div>
  );
}
