import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ALL_OBJECTS_ID } from "../../app/constants";
import { useDebouncedValue } from "../../shared/hooks/useDebouncedValue";
import { repairUploadedFileName } from "../../shared/fileName";
import { EmptyState, LoadingState, ResultBanner } from "../../shared/ui/StateViews";
import { PageHero } from "../ui/PageHero";
import { ResponsiveTableShell } from "../layout/MobileCardParts";
import {
  buildProductivityTree,
  collapseProductivitySubtree,
  countAllProductivityMaterials,
  countProductivityMaterials,
  filterProductivityTree,
  productivityTreeIndentPx,
  type ProductivityRow,
  type ProductivityTreeNode
} from "./productivityTree";

type DateColumn = { col: number; date: string };

type SheetPayload = {
  id: string;
  title: string;
  sourceFileName: string;
  dateColumns: DateColumn[];
  cellValues: Record<string, string | number | null>;
  rows: ProductivityRow[];
  updatedAt: string;
};

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  warehouseId: string;
  section: "SS" | "EOM";
  warehouseName: string;
  canWrite: boolean;
  onUploadFile: (file: File) => Promise<void>;
  uploadBusy: boolean;
};

function cellKey(row: number, col: number) {
  return `${row}:${col}`;
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function formatDay(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function formatMonthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

function nodeId(node: ProductivityTreeNode) {
  return String(node.row.rowIndex);
}

export function ProductivityTab({
  token,
  apiUrl,
  fetchWithSession,
  warehouseId,
  section,
  warehouseName,
  canWrite,
  onUploadFile,
  uploadBusy
}: Props) {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sheet, setSheet] = useState<SheetPayload | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 280);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const pendingRef = useRef<Map<string, string | number | null>>(new Map());
  const saveTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID) {
      setSheet(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ warehouseId, section });
      const res = await fetchWithSession(`${apiUrl}/api/productivity?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SheetPayload | null;
      setSheet(data);
    } catch (e) {
      setMessage(`Не удалось загрузить выработку: ${String(e)}`);
      setSheet(null);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl, fetchWithSession, warehouseId, section]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setExpanded({});
    setSearch("");
  }, [warehouseId, section, sheet?.id]);

  const availableMonths = useMemo(() => {
    if (!sheet?.dateColumns.length) return [month];
    const set = new Set(sheet.dateColumns.map((d) => monthKey(d.date)));
    return [...set].sort();
  }, [sheet, month]);

  useEffect(() => {
    if (availableMonths.length && !availableMonths.includes(month)) {
      setMonth(availableMonths[availableMonths.length - 1]!);
    }
  }, [availableMonths, month]);

  const visibleDates = useMemo(() => {
    if (!sheet) return [];
    return sheet.dateColumns.filter((d) => monthKey(d.date) === month);
  }, [sheet, month]);

  const displayFileName = useMemo(
    () => (sheet ? repairUploadedFileName(sheet.sourceFileName) : ""),
    [sheet]
  );

  const fullTree = useMemo(
    () => (sheet?.rows?.length ? buildProductivityTree(sheet.rows) : []),
    [sheet]
  );

  const { nodes: visibleTree, expandIds } = useMemo(
    () => filterProductivityTree(fullTree, debouncedSearch),
    [fullTree, debouncedSearch]
  );

  const searchActive = debouncedSearch.trim().length > 0;
  const totalMaterials = useMemo(() => countAllProductivityMaterials(fullTree), [fullTree]);
  const visibleMaterials = useMemo(() => countAllProductivityMaterials(visibleTree), [visibleTree]);

  useEffect(() => {
    if (!searchActive || !expandIds.size) return;
    setExpanded((prev) => {
      const next = { ...prev };
      for (const id of expandIds) next[id] = true;
      return next;
    });
  }, [searchActive, expandIds]);

  const flushSaves = useCallback(async () => {
    if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID || pendingRef.current.size === 0) return;
    const cells = [...pendingRef.current.entries()].map(([key, value]) => {
      const [row, col] = key.split(":").map(Number);
      return { row, col, value };
    });
    pendingRef.current.clear();
    setSaving(true);
    try {
      const params = new URLSearchParams({ warehouseId, section });
      const res = await fetchWithSession(`${apiUrl}/api/productivity/cells?${params}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cells })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SheetPayload;
      setSheet((prev) => (prev ? { ...prev, cellValues: data.cellValues, updatedAt: data.updatedAt } : prev));
    } catch (e) {
      setMessage(`Ошибка сохранения: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [token, apiUrl, fetchWithSession, warehouseId, section]);

  const queueSave = useCallback(
    (row: number, col: number, value: string | number | null) => {
      pendingRef.current.set(cellKey(row, col), value);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        void flushSaves();
      }, 450);
    },
    [flushSaves]
  );

  const onCellChange = (rowIndex: number, col: number, raw: string) => {
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed.replace(",", "."));
    const nextVal = trimmed === "" ? null : Number.isFinite(value) ? value! : trimmed;
    setSheet((prev) => {
      if (!prev) return prev;
      const cellValues = { ...prev.cellValues };
      const key = cellKey(rowIndex, col);
      if (nextVal == null) delete cellValues[key];
      else cellValues[key] = nextVal;
      return { ...prev, cellValues };
    });
    queueSave(rowIndex, col, nextVal);
  };

  const toggleGroup = (node: ProductivityTreeNode) => {
    const id = nodeId(node);
    const siblings = findSiblingGroups(node, fullTree);
    setExpanded((prev) => {
      const willExpand = !prev[id];
      let next = { ...prev };

      if (willExpand) {
        for (const s of siblings) {
          if (nodeId(s) !== id) {
            next = collapseProductivitySubtree(next, nodeId(s), fullTree);
          }
        }
      }

      next[id] = willExpand;
      if (!willExpand) {
        next = collapseProductivitySubtree(next, id, fullTree);
      }
      return next;
    });
  };

  const download = async () => {
    if (!token) return;
    setMessage("");
    try {
      const params = new URLSearchParams({ warehouseId, section });
      const res = await fetchWithSession(`${apiUrl}/api/productivity/download?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const name =
        res.headers.get("Content-Disposition")?.match(/filename\*?=(?:UTF-8'')?\"?([^\";]+)/)?.[1] ||
        displayFileName ||
        sheet?.sourceFileName ||
        "vyrobotka.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = decodeURIComponent(name);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(`Не удалось скачать: ${String(e)}`);
    }
  };

  const renderMaterialRow = (row: ProductivityRow, depth: number) => {
    const indent = productivityTreeIndentPx(depth);
    return (
      <tr key={row.rowIndex} className="productivityMaterialRow">
        <td className="productivitySticky muted" style={{ paddingLeft: indent + 8 }}>
          {row.workCode || row.indexLabel || "—"}
        </td>
        <td className="productivitySticky productivityNameCol" title={row.name} style={{ paddingLeft: indent + 8 }}>
          {row.name}
        </td>
        <td>{row.unit || "—"}</td>
        {visibleDates.map((d) => {
          const key = cellKey(row.rowIndex, d.col);
          const val = sheet?.cellValues[key];
          return (
            <td key={d.col} className="productivityDayCol">
              {canWrite ? (
                <input
                  type="text"
                  inputMode="decimal"
                  className="productivityCellInput"
                  value={val == null ? "" : String(val)}
                  onChange={(e) => onCellChange(row.rowIndex, d.col, e.target.value)}
                />
              ) : (
                <span>{val == null ? "" : String(val)}</span>
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  const renderTree = (nodes: ProductivityTreeNode[], depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    const colSpan = 3 + visibleDates.length;

    for (const node of nodes) {
      if (!node) continue;
      if (node.type === "GROUP") {
        const id = nodeId(node);
        const isExpanded = Boolean(expanded[id]);
        const matCount = countProductivityMaterials(node);
        const childList = node.children || [];
        const subCount = childList.filter((c) => c?.type === "GROUP").length;
        const indent = productivityTreeIndentPx(depth);

        out.push(
          <tr key={`group-${id}`} className="productivityGroupRow">
            <td colSpan={colSpan} className="productivityGroupCell">
              <div className="limitGroupRow productivityGroupRowInner" style={{ paddingLeft: indent }}>
                <button
                  type="button"
                  className="ghostBtn productivityGroupToggle"
                  aria-label={isExpanded ? "Свернуть раздел" : "Раскрыть раздел"}
                  onClick={() => toggleGroup(node)}
                  disabled={!childList.length}
                >
                  {childList.length ? (isExpanded ? "▾" : "▸") : "•"}
                </button>
                <div className="limitGroupRowMain">
                  <strong className="productivityGroupTitle">{node.row.name}</strong>
                  {node.row.indexLabel ? <span className="muted productivityGroupCode">{node.row.indexLabel}</span> : null}
                  {node.row.workCode ? <span className="muted productivityGroupCode">{node.row.workCode}</span> : null}
                  <span className="muted productivityGroupMeta">
                    {matCount ? `${matCount} поз.` : null}
                    {subCount ? `${matCount ? " · " : ""}${subCount} подразд.` : null}
                  </span>
                </div>
              </div>
            </td>
          </tr>
        );

        if (isExpanded) {
          out.push(...renderTree(childList, depth + 1));
        }
        continue;
      }

      out.push(renderMaterialRow(node.row, depth));
    }

    return out;
  };

  if (!warehouseId || warehouseId === ALL_OBJECTS_ID) {
    return (
      <EmptyState
        title="Выберите объект"
        hint="Для выработки нужен конкретный объект вверху экрана (не «Все объекты»)."
      />
    );
  }

  if (loading) return <LoadingState text="Загрузка выработки…" />;

  return (
    <div className="tabShell productivityTab">
      <PageHero
        title="Выработка"
        subtitle={`${warehouseName} · раздел ${section === "SS" ? "СС" : "ЭОМ"}`}
        stats={
          sheet
            ? [
                {
                  label: searchActive ? "Найдено" : "Позиций",
                  value: searchActive ? `${visibleMaterials} из ${totalMaterials}` : totalMaterials
                },
                { label: "Разделов", value: sheet.rows.filter((r) => r?.nodeType === "GROUP").length },
                { label: "Дней", value: visibleDates.length }
              ]
            : undefined
        }
        actions={
          <>
            <button type="button" className="ghostBtn" onClick={() => void load()}>
              ↻
            </button>
            {sheet ? (
              <button type="button" className="primaryBtn" onClick={() => void download()}>
                Скачать Excel
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="ghostBtn"
                disabled={uploadBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadBusy ? "Загрузка…" : sheet ? "Заменить шаблон" : "Загрузить шаблон"}
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onUploadFile(f);
              }}
            />
          </>
        }
      />

      {message ? <ResultBanner tone="error" text={message} /> : null}

      {!sheet ? (
        <EmptyState
          title="Шаблон не загружен"
          hint={
            canWrite
              ? "Перетащите Excel-файл выработки на страницу или нажмите «Загрузить шаблон». После заполнения можно скачать тот же файл с вашими данными."
              : "Попросите ответственного загрузить шаблон выработки для этого объекта."
          }
        />
      ) : (
        <>
          <div className="productivityInfoCard">
            <span className="productivityInfoIcon" aria-hidden>
              📊
            </span>
            <div className="productivityInfoBody">
              <p className="productivityInfoTitle" title={displayFileName}>
                {displayFileName}
              </p>
              <p className="productivityInfoMeta muted">
                Обновлено {new Date(sheet.updatedAt).toLocaleString("ru-RU")}
                {saving ? " · сохранение…" : " · изменения сохраняются автоматически"}
              </p>
            </div>
          </div>

          <div className="whControlBar productivityControlBar">
            <div className="whSearchRow">
              <input
                type="search"
                className="whSearchInput"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск: наименование, код, единица…"
                aria-label="Поиск по выработке"
              />
            </div>
            <div className="whToolbar">
              <label className="productivityMonthLabel">
                Месяц
                <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Месяц">
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {formatMonthLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
              {search.trim() ? (
                <button type="button" className="ghostBtn" onClick={() => setSearch("")}>
                  Сбросить
                </button>
              ) : null}
            </div>
          </div>

          {!visibleTree.length || visibleMaterials === 0 ? (
            <EmptyState
              title="Ничего не нашлось"
              hint="Попробуйте другой запрос или сбросьте поиск."
              action={
                search.trim() ? (
                  <button type="button" className="ghostBtn" onClick={() => setSearch("")}>
                    Сбросить поиск
                  </button>
                ) : undefined
              }
            />
          ) : (
            <ResponsiveTableShell>
              <div className="erpTableWrap productivityTableWrap">
                <table className="erpTable desktopTable productivityTable">
                  <thead>
                    <tr>
                      <th className="productivitySticky">Код</th>
                      <th className="productivitySticky productivityNameCol">Наименование</th>
                      <th>Ед.</th>
                      {visibleDates.map((d) => (
                        <th key={d.col} className="productivityDayCol">
                          {formatDay(d.date)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="productivityTreeBody">{renderTree(visibleTree, 0)}</tbody>
                </table>
              </div>
            </ResponsiveTableShell>
          )}
        </>
      )}
    </div>
  );
}

function findSiblingGroups(node: ProductivityTreeNode, roots: ProductivityTreeNode[]): ProductivityTreeNode[] {
  const walk = (nodes: ProductivityTreeNode[], parent: ProductivityTreeNode | null): ProductivityTreeNode[] | null => {
    for (const n of nodes) {
      if (n === node) {
        return parent ? parent.children.filter((c) => c.type === "GROUP") : roots.filter((c) => c.type === "GROUP");
      }
      const found = walk(n.children, n);
      if (found) return found;
    }
    return null;
  };
  return walk(roots, null) || [];
}
