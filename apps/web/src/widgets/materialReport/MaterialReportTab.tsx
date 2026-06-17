import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDebouncedValue } from "../../shared/hooks/useDebouncedValue";
import { useViewportContext } from "../layout/ViewportRoot";
import { TabObjectFilter } from "../layout/TabObjectFilter";
import { EmptyState, LoadingState, ResultBanner } from "../../shared/ui/StateViews";
import { PageHero } from "../ui/PageHero";
import { UserAvatar } from "../chat/UserAvatar";
import { MaterialReportWriteoffModal, type WriteoffLine } from "./MaterialReportWriteoffModal";
import { formatMaterialQty } from "../../shared/quantity";
import { formatMoney, formatMoneyOrDash } from "../../shared/pricing";

export type MaterialReportLine = {
  materialId: string;
  name: string;
  unit: string;
  quantity: number;
  catalogLineTotal?: number | null;
  priceBasisQty?: number | null;
  unitCost?: number | null;
  totalAmount?: number | null;
};

export type MaterialReportIssueGroup = {
  issueId: string;
  issueNumber: string;
  issuedAt: string;
  warehouseId: string;
  section: "SS" | "EOM";
  totalAmount?: number | null;
  lines: MaterialReportLine[];
};

export type MaterialReportHolder = {
  holderKey: string;
  holderUserId?: string | null;
  holderName: string;
  isWarehouseBalance?: boolean;
  issueNumbers?: string[];
  lastIssueAt?: string | null;
  totalAmount?: number | null;
  pricedLineCount?: number;
  unpricedLineCount?: number;
  issues: MaterialReportIssueGroup[];
  lines: MaterialReportLine[];
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

type MatReportUser = {
  id: string;
  fullName: string;
  avatarUrl?: string | null;
  position?: string | null;
  role?: string;
  isMol?: boolean;
};

type SubTab = "balances" | "history";
type SectionFilter = "ALL" | "SS" | "EOM";

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  warehouses: Array<{ id: string; name: string }>;
  canWriteoff: boolean;
  safeName: (s: string) => string;
  roleLabel: (role: string) => string;
  exportAction?: ReactNode;
  onOpenChat?: (userId: string) => void;
  onOpenUserProfile?: (userId: string) => void;
};

function lineKey(holderKey: string, materialId: string) {
  return `${holderKey}:${materialId}`;
}

function formatQty(n: number) {
  return formatMaterialQty(n);
}

function MaterialLineAmounts({ line }: { line: MaterialReportLine }) {
  return (
    <span className="materialReportBubbleQty">
      <span>
        {formatQty(Number(line.quantity))} {line.unit}
      </span>
      {line.totalAmount != null && Number.isFinite(Number(line.totalAmount)) ? (
        <span className="materialReportBubbleMoney">
          {line.unitCost != null && Number.isFinite(Number(line.unitCost)) ? (
            <span className="muted">{formatMoney(Number(line.unitCost))} ₽/ед.</span>
          ) : null}
          <strong>{formatMoneyOrDash(line.totalAmount)}</strong>
        </span>
      ) : (
        <span className="materialReportBubbleMoney muted">сумма не указана</span>
      )}
    </span>
  );
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU");
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ru-RU");
}

function userHolderKey(userId: string) {
  return `user:${userId}`;
}

export function MaterialReportTab({
  token,
  apiUrl,
  fetchWithSession,
  warehouses,
  canWriteoff,
  safeName,
  roleLabel,
  exportAction,
  onOpenChat,
  onOpenUserProfile
}: Props) {
  const { isMobile } = useViewportContext();
  const [subTab, setSubTab] = useState<SubTab>("balances");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>("ALL");
  const [molUsers, setMolUsers] = useState<MatReportUser[]>([]);
  const [holders, setHolders] = useState<MaterialReportHolder[]>([]);
  const [history, setHistory] = useState<MaterialWriteoffHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [holderSearch, setHolderSearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [issueSearch, setIssueSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const debouncedHistorySearch = useDebouncedValue(historySearch, 280);
  const [expandedIssues, setExpandedIssues] = useState<Record<string, boolean>>({});
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [writeoffOpen, setWriteoffOpen] = useState(false);

  const warehouseNameById = useMemo(
    () => new Map(warehouses.map((w) => [w.id, w.name])),
    [warehouses]
  );

  const loadMolUsers = useCallback(async () => {
    if (!token || !warehouseFilter) {
      setMolUsers([]);
      return;
    }
    const params = new URLSearchParams({
      warehouseId: warehouseFilter,
      section: sectionFilter
    });
    const res = await fetchWithSession(`${apiUrl}/api/material-report/mol-users?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setMolUsers((await res.json()) as MatReportUser[]);
    } else {
      setMolUsers([]);
    }
  }, [token, apiUrl, fetchWithSession, warehouseFilter, sectionFilter]);

  const reportQuery = useCallback(() => {
    const params = new URLSearchParams({ section: sectionFilter });
    if (warehouseFilter) params.set("warehouseId", warehouseFilter);
    return params;
  }, [warehouseFilter, sectionFilter]);

  const loadBalances = useCallback(async () => {
    if (!token) return;
    const res = await fetchWithSession(`${apiUrl}/api/material-report/balances?${reportQuery()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(typeof err.error === "string" ? err.error : `Ошибка ${res.status}`);
    }
    setHolders((await res.json()) as MaterialReportHolder[]);
  }, [token, apiUrl, fetchWithSession, reportQuery]);

  const loadHistory = useCallback(async () => {
    if (!token) return;
    const params = reportQuery();
    params.set("take", "500");
    if (debouncedHistorySearch.trim()) params.set("q", debouncedHistorySearch.trim());
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (selectedKey && subTab === "history") params.set("holderKey", selectedKey);
    const res = await fetchWithSession(`${apiUrl}/api/material-report/writeoffs/history?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(typeof err.error === "string" ? err.error : `Ошибка ${res.status}`);
    }
    setHistory((await res.json()) as MaterialWriteoffHistoryRow[]);
  }, [token, apiUrl, fetchWithSession, reportQuery, debouncedHistorySearch, dateFrom, dateTo, selectedKey, subTab]);

  const reload = useCallback(async () => {
    if (!token) return;
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
  }, [token, loadBalances, loadHistory]);

  useEffect(() => {
    void loadMolUsers();
  }, [loadMolUsers]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (subTab === "history") void loadHistory();
  }, [subTab, loadHistory]);

  const holdersByKey = useMemo(() => new Map(holders.map((h) => [h.holderKey, h])), [holders]);

  const molUserKeys = useMemo(() => new Set(molUsers.map((u) => userHolderKey(u.id))), [molUsers]);

  const sidebarUsers = useMemo(() => {
    const q = holderSearch.trim().toLowerCase();
    return molUsers.filter((u) => !q || u.fullName.toLowerCase().includes(q));
  }, [molUsers, holderSearch]);

  const sidebarExtras = useMemo(() => {
    const q = holderSearch.trim().toLowerCase();
    return holders.filter((h) => {
      if (molUserKeys.has(h.holderKey)) return false;
      if (h.holderKey.startsWith("user:")) return false;
      if (h.holderKey === "__storekeeper__") return false;
      if (!h.lines.length) return false;
      return !q || h.holderName.toLowerCase().includes(q);
    });
  }, [holders, molUserKeys, holderSearch]);

  const sidebarHasAny = sidebarUsers.length > 0 || sidebarExtras.length > 0;

  useEffect(() => {
    if (!sidebarHasAny) {
      setSelectedKey("");
      return;
    }
    const keys = [
      ...sidebarUsers.map((u) => userHolderKey(u.id)),
      ...sidebarExtras.map((h) => h.holderKey)
    ];
    if (!selectedKey || !keys.includes(selectedKey)) {
      setSelectedKey(keys[0]!);
    }
  }, [sidebarUsers, sidebarExtras, sidebarHasAny, selectedKey]);

  const selectedHolder = useMemo(
    () => (selectedKey ? holdersByKey.get(selectedKey) ?? null : null),
    [selectedKey, holdersByKey]
  );

  const selectedUser = useMemo(() => {
    if (!selectedKey.startsWith("user:")) return null;
    const id = selectedKey.slice(5);
    return molUsers.find((u) => u.id === id) ?? null;
  }, [selectedKey, molUsers]);

  const threadTitle = selectedUser?.fullName ?? selectedHolder?.holderName ?? "";
  const threadSubtitle = selectedUser
    ? selectedUser.position?.trim() || roleLabel(selectedUser.role || "") || "Сотрудник"
    : selectedHolder?.isWarehouseBalance
      ? "остаток на складе"
      : selectedHolder
        ? "подотчёт"
        : "";

  const filteredIssues = useMemo(() => {
    if (!selectedHolder?.issues?.length) return [];
    const issueQ = issueSearch.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;
    return selectedHolder.issues.filter((iss) => {
      if (issueQ && !iss.issueNumber.toLowerCase().includes(issueQ)) return false;
      if (fromTs || toTs) {
        const at = new Date(iss.issuedAt).getTime();
        if (fromTs && at < fromTs) return false;
        if (toTs && at > toTs) return false;
      }
      return iss.lines.length > 0;
    });
  }, [selectedHolder, issueSearch, dateFrom, dateTo]);

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

  const checkedLines = useMemo(() => {
    if (!selectedHolder || subTab !== "balances" || !warehouseFilter) return [] as WriteoffLine[];
    return visibleLines
      .filter((ln) => checked[lineKey(selectedHolder.holderKey, ln.materialId)])
      .map((ln) => ({
        holderKey: selectedHolder.holderKey,
        materialId: ln.materialId,
        name: ln.name,
        unit: ln.unit,
        maxQty: Number(ln.quantity) || 0
      }));
  }, [selectedHolder, visibleLines, checked, subTab, warehouseFilter]);

  const writeoffSection: "SS" | "EOM" =
    sectionFilter === "ALL" ? "SS" : sectionFilter;

  const showThread = Boolean(selectedKey);
  const showList = !isMobile || !showThread;
  const posCount = holders.reduce((n, h) => n + h.lines.length, 0);
  const reportTotalAmount = useMemo(() => {
    let sum = 0;
    let hasAny = false;
    for (const h of holders) {
      if (h.totalAmount != null && Number.isFinite(h.totalAmount)) {
        sum += h.totalAmount;
        hasAny = true;
      }
    }
    return hasAny ? sum : null;
  }, [holders]);
  const unpricedCount = useMemo(
    () => holders.reduce((n, h) => n + (h.unpricedLineCount ?? 0), 0),
    [holders]
  );
  const selectedUserId = selectedUser?.id;

  function holderMoneyPreview(h: MaterialReportHolder) {
    const parts: string[] = [];
    if (h.totalAmount != null && Number.isFinite(h.totalAmount)) {
      parts.push(formatMoneyOrDash(h.totalAmount));
    }
    if (h.lines.length === 1) {
      parts.push(`${safeName(h.lines[0]!.name)} · ${formatQty(Number(h.lines[0]!.quantity))}`);
    } else {
      parts.push(`${h.lines.length} поз. · ${formatQty(h.lines.reduce((n, x) => n + Number(x.quantity), 0))}`);
    }
    if (!h.totalAmount && (h.unpricedLineCount ?? 0) > 0) {
      parts.push("без цены");
    }
    return parts.join(" · ");
  }

  function userBalancePreview(userId: string) {
    const h = holdersByKey.get(userHolderKey(userId));
    if (!h?.lines.length) return "нет подотчёта";
    return holderMoneyPreview(h);
  }

  return (
    <div className={`materialReportPage chatPage ${isMobile && showThread ? "chatPage--thread" : ""}`}>
      <PageHero
        variant="compact"
        icon="▪"
        title="Материальный отчёт"
        subtitle="МОЛ объекта · подотчёт и списания"
        stats={[
          { label: "МОЛ", value: molUsers.length, tone: "neutral" },
          { label: "С подотчётом", value: holders.filter((h) => h.lines.length > 0).length, tone: "ok" },
          { label: "Позиций", value: posCount, tone: posCount > 0 ? "ok" : "neutral" },
          {
            label: "На подотчёте",
            value: reportTotalAmount != null ? formatMoneyOrDash(reportTotalAmount) : "—",
            tone: reportTotalAmount != null && reportTotalAmount > 0 ? "ok" : "neutral"
          }
        ]}
        actions={
          <>
            <button type="button" className="ghostBtn" disabled={loading} onClick={() => void reload()}>
              ↻ Обновить
            </button>
            {exportAction}
          </>
        }
      />

      <div className="materialReportFiltersBar">
        <TabObjectFilter
          value={warehouseFilter}
          onChange={setWarehouseFilter}
          warehouses={warehouses}
        />
        <div className="materialReportSectionToggle" role="group" aria-label="Раздел СС или ЭОМ">
          <button
            type="button"
            className={sectionFilter === "ALL" ? "active" : ""}
            onClick={() => setSectionFilter("ALL")}
          >
            Все разделы
          </button>
          <button
            type="button"
            className={sectionFilter === "SS" ? "active" : ""}
            onClick={() => setSectionFilter("SS")}
          >
            СС
          </button>
          <button
            type="button"
            className={sectionFilter === "EOM" ? "active" : ""}
            onClick={() => setSectionFilter("EOM")}
          >
            ЭОМ
          </button>
        </div>
      </div>

      <nav className="materialReportSubNav" aria-label="Разделы материального отчёта">
        <button type="button" className={subTab === "balances" ? "active" : ""} onClick={() => setSubTab("balances")}>
          Подотчёт
        </button>
        <button type="button" className={subTab === "history" ? "active" : ""} onClick={() => setSubTab("history")}>
          История списаний
        </button>
      </nav>

      {unpricedCount > 0 ? (
        <p className="muted materialReportPriceHint">
          У {unpricedCount} поз. не указана сумма в приходе или карточке — стоимость по ним не рассчитана.
        </p>
      ) : null}

      {message ? (
        <ResultBanner text={message} tone={/ошиб|403|502|недостат/i.test(message) ? "error" : "neutral"} />
      ) : null}

      {loading && !holders.length && !molUsers.length ? (
        <LoadingState text="Загрузка материального отчёта…" />
      ) : (
        <div className="chatLayout materialReportLayout">
          {showList ? (
            <aside className="chatSidebar materialReportSidebar" aria-label="Сотрудники">
              <div className="chatSidebarSearch">
                <input
                  type="search"
                  value={holderSearch}
                  onChange={(e) => setHolderSearch(e.target.value)}
                  placeholder="Поиск по ФИО…"
                  aria-label="Поиск сотрудника"
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
                </div>
              )}

              <div className="chatSidebarSection chatSidebarSectionGrow">
                <span className="chatSidebarSectionTitle">
                  {subTab === "balances" ? "МОЛ объекта" : "Списания по людям"}
                </span>
                {!warehouseFilter ? (
                  <p className="chatSidebarEmpty muted">Выберите объект в фильтре выше</p>
                ) : !sidebarHasAny ? (
                  <p className="chatSidebarEmpty muted">
                    Нет МОЛ на объекте. Отметьте сотрудников в карточке пользователя (Доступы).
                  </p>
                ) : null}
                <ul className="chatContactList">
                  {sidebarUsers.map((u) => {
                        const key = userHolderKey(u.id);
                        const active = key === selectedKey;
                        const h = holdersByKey.get(key);
                        return (
                          <li key={u.id}>
                            <div
                              className={`chatContact ${active ? "active" : ""}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedKey(key)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedKey(key);
                                }
                              }}
                            >
                              <UserAvatar
                                fullName={u.fullName}
                                avatarUrl={u.avatarUrl}
                                onClick={
                                  onOpenUserProfile
                                    ? (e) => {
                                        e.stopPropagation();
                                        onOpenUserProfile(u.id);
                                      }
                                    : undefined
                                }
                              />
                              <span className="chatContactBody">
                                <span className="chatContactTop">
                                  <strong>{safeName(u.fullName)}</strong>
                                  <time>{formatDate(h?.lastIssueAt)}</time>
                                </span>
                                <span className="chatContactPreview muted">
                                  {subTab === "history"
                                    ? (() => {
                                        const g = historyByHolder.find((x) => x.key === key);
                                        return g
                                          ? `${g.rows.length} списан. · ${formatQty(g.totalQty)}`
                                          : "нет списаний";
                                      })()
                                    : userBalancePreview(u.id)}
                                </span>
                              </span>
                            </div>
                          </li>
                        );
                      })}
                  {sidebarExtras.map((h) => {
                        const active = h.holderKey === selectedKey;
                        return (
                          <li key={h.holderKey}>
                            <div
                              className={`chatContact ${active ? "active" : ""}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedKey(h.holderKey)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedKey(h.holderKey);
                                }
                              }}
                            >
                              <UserAvatar fullName={h.holderName} />
                              <span className="chatContactBody">
                                <span className="chatContactTop">
                                  <strong>{safeName(h.holderName)}</strong>
                                  <time>{formatDate(h.lastIssueAt)}</time>
                                </span>
                                <span className="chatContactPreview muted">
                                  {subTab === "history"
                                    ? (() => {
                                        const g = historyByHolder.find((x) => x.key === h.holderKey);
                                        return g
                                          ? `${g.rows.length} списан. · ${formatQty(g.totalQty)}`
                                          : "нет списаний";
                                      })()
                                    : (
                                        <>
                                          {h.isWarehouseBalance ? "склад · " : ""}
                                          {holderMoneyPreview(h)}
                                        </>
                                      )}
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
              showThread ? (
                <>
                  <header className="chatThreadHead materialReportThreadHead">
                    {isMobile ? (
                      <button type="button" className="ghostBtn chatBackBtn" onClick={() => setSelectedKey("")}>
                        ←
                      </button>
                    ) : null}
                    <UserAvatar
                      fullName={threadTitle}
                      avatarUrl={selectedUser?.avatarUrl}
                      size="lg"
                      onClick={
                        selectedUserId && onOpenUserProfile
                          ? () => onOpenUserProfile(selectedUserId)
                          : undefined
                      }
                    />
                    <div className="chatThreadHeadText">
                      <strong>{safeName(threadTitle)}</strong>
                      <span className="muted">
                        {threadSubtitle}
                        {selectedHolder?.totalAmount != null && Number.isFinite(selectedHolder.totalAmount)
                          ? ` · ${formatMoneyOrDash(selectedHolder.totalAmount)} на подотчёте`
                          : selectedHolder?.lines.length
                            ? " · сумма не рассчитана"
                            : ""}
                      </span>
                    </div>
                    {selectedUserId && onOpenChat ? (
                      <button
                        type="button"
                        className="primaryBtn materialReportWriteBtn"
                        onClick={() => onOpenChat(selectedUserId)}
                      >
                        Написать
                      </button>
                    ) : null}
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
                        disabled={checkedLines.length === 0 || !warehouseFilter}
                        title={!warehouseFilter ? "Выберите объект для списания" : undefined}
                        onClick={() => setWriteoffOpen(true)}
                      >
                        Списать ({checkedLines.length})
                      </button>
                    ) : null}
                  </div>

                  {!warehouseFilter && canWriteoff ? (
                    <p className="muted materialReportWriteoffHint">
                      Для списания выберите конкретный объект в фильтре выше.
                    </p>
                  ) : null}

                  <div className="chatThreadMessages materialReportMessages">
                    {!filteredIssues.length && !visibleLines.length ? (
                      <EmptyState
                        title="Нет подотчёта"
                        hint="У выбранного сотрудника нет выданных материалов по текущим фильтрам."
                      />
                    ) : (
                      <>
                        <p className="materialReportIssuesLegend muted">По выдачам</p>
                        <div className="plainList materialReportIssueList">
                          {filteredIssues.map((iss) => {
                            const open = expandedIssues[iss.issueId] ?? true;
                            const whName = warehouseNameById.get(iss.warehouseId);
                            return (
                              <div key={iss.issueId} className="materialReportIssueGroup">
                                <button
                                  type="button"
                                  className="materialReportIssueHead"
                                  onClick={() =>
                                    setExpandedIssues((prev) => ({ ...prev, [iss.issueId]: !open }))
                                  }
                                >
                                  <span className="materialReportHistoryChevron">{open ? "▾" : "▸"}</span>
                                  <strong>
                                    {iss.issueNumber}
                                    {whName ? ` · ${safeName(whName)}` : ""}
                                  </strong>
                                  <span className="muted">
                                    {formatDate(iss.issuedAt)}
                                    {sectionFilter === "ALL" ? ` · ${iss.section}` : ""}
                                    {iss.totalAmount != null && Number.isFinite(iss.totalAmount)
                                      ? ` · ${formatMoneyOrDash(iss.totalAmount)}`
                                      : ""}
                                  </span>
                                </button>
                                {open ? (
                                  <div className="materialReportIssueLines">
                                    {iss.lines.map((ln) => (
                                      <div key={`${iss.issueId}-${ln.materialId}`} className="chatBubble theirs materialReportBubble">
                                        <div className="materialReportBubbleBody">
                                          <p className="chatBubbleText">{safeName(ln.name)}</p>
                                          <MaterialLineAmounts line={ln} />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        {visibleLines.length > 0 ? (
                          <div className="materialReportNetBlock">
                            <h4 className="materialReportNetTitle">Остаток к списанию</h4>
                            {visibleLines.map((ln) => {
                              if (!selectedHolder) return null;
                              const key = lineKey(selectedHolder.holderKey, ln.materialId);
                              const isChecked = Boolean(checked[key]);
                              return (
                                <div
                                  key={key}
                                  className={`chatBubble theirs materialReportBubble ${isChecked ? "selected" : ""}`}
                                >
                                  {canWriteoff && warehouseFilter ? (
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
                                    <MaterialLineAmounts line={ln} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="chatThreadEmpty muted">Выберите сотрудника слева</div>
              )
            ) : showThread ? (
              <>
                <header className="chatThreadHead materialReportThreadHead">
                  {isMobile ? (
                    <button type="button" className="ghostBtn chatBackBtn" onClick={() => setSelectedKey("")}>
                      ←
                    </button>
                  ) : null}
                  <UserAvatar
                    fullName={threadTitle}
                    avatarUrl={selectedUser?.avatarUrl}
                    size="lg"
                  />
                  <div className="chatThreadHeadText">
                    <strong>{safeName(threadTitle) || "История списаний"}</strong>
                    <span className="muted">{history.length} записей</span>
                  </div>
                </header>

                <div className="chatThreadMessages materialReportHistoryPane">
                  {!historyByHolder.length ? (
                    <EmptyState title="Списаний нет" hint="За выбранный период записей не найдено." />
                  ) : (
                    <div className="plainList limitTree">
                      {(selectedKey
                        ? historyByHolder.filter((g) => g.key === selectedKey)
                        : historyByHolder
                      ).map((group) => {
                        const open = expandedHistory[group.key] ?? selectedKey === group.key;
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
              <div className="chatThreadEmpty muted">Выберите сотрудника слева</div>
            )}
          </section>
        </div>
      )}

      {writeoffOpen && checkedLines.length > 0 && warehouseFilter ? (
        <MaterialReportWriteoffModal
          lines={checkedLines}
          token={token}
          apiUrl={apiUrl}
          warehouseId={warehouseFilter}
          section={writeoffSection}
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
