import { useCallback, useEffect, useMemo, useState } from "react";
import { ToolsListToolbar } from "./ToolsListToolbar";
import { ToolConsumableDrawer } from "./ToolConsumableDrawer";
import { ToolConsumableIssueModal } from "./ToolConsumableIssueModal";
import { ToolConsumableListTable } from "./ToolConsumableListTable";
import type { ToolCatalogConsumableLine } from "./toolCatalog";

type Props = {
  warehouseId: string;
  sectionFilter: "SS" | "EOM";
  token: string | null;
  apiUrl: string;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  canWrite?: boolean;
  onAddCatalogItem?: () => void;
  onCatalogMessage?: (msg: string, tone?: "success" | "error" | "neutral") => void;
  catalogRefreshNonce?: number;
  recipientSuggestions: string[];
  safeName: (name: string) => string;
  onDrawerOpenChange?: (open: boolean) => void;
};

export function ToolConsumablesCatalogSection({
  warehouseId,
  sectionFilter,
  token,
  apiUrl,
  fetchWithSession,
  canWrite,
  onAddCatalogItem,
  onCatalogMessage,
  catalogRefreshNonce = 0,
  recipientSuggestions,
  safeName,
  onDrawerOpenChange
}: Props) {
  const [lines, setLines] = useState<ToolCatalogConsumableLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [issueLine, setIssueLine] = useState<ToolCatalogConsumableLine | null>(null);
  const [issueSubmitting, setIssueSubmitting] = useState(false);

  const loadLines = useCallback(async () => {
    if (!token) {
      setLines([]);
      return;
    }
    setLoading(true);
    const q = new URLSearchParams({
      section: "TOOL_CONSUMABLE",
      sectionFilter,
      splitByCondition: "1"
    });
    if (warehouseId) q.set("warehouseId", warehouseId);
    if (search.trim()) q.set("q", search.trim());
    try {
      const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/materials?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setLines((await res.json()) as ToolCatalogConsumableLine[]);
      else setLines([]);
    } finally {
      setLoading(false);
    }
  }, [token, warehouseId, sectionFilter, search, apiUrl, fetchWithSession]);

  useEffect(() => {
    void loadLines();
  }, [loadLines, catalogRefreshNonce]);

  const selectedLine = useMemo(
    () => lines.find((l) => l.key === selectedKey) ?? null,
    [lines, selectedKey]
  );

  useEffect(() => {
    onDrawerOpenChange?.(Boolean(selectedKey));
  }, [selectedKey, onDrawerOpenChange]);

  async function submitIssue(data: { recipient: string; quantity: number; comment: string }) {
    if (!token || !issueLine || !warehouseId) return false;
    setIssueSubmitting(true);
    try {
      const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/consumables/issue-direct`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          section: sectionFilter,
          materialId: issueLine.materialId,
          condition: issueLine.condition,
          quantity: data.quantity,
          holderName: data.recipient,
          comment: data.comment || undefined
        })
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        onCatalogMessage?.(err.error || "Не удалось выдать расходник", "error");
        return false;
      }
      onCatalogMessage?.("Расходник выдан", "success");
      setIssueLine(null);
      setSelectedKey(null);
      await loadLines();
      return true;
    } finally {
      setIssueSubmitting(false);
    }
  }

  return (
    <>
      <div className="toolsCatalogListSection" style={{ marginTop: 16 }}>
        <ToolsListToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Поиск: наименование расходника"
          filters={null}
          actions={
            <>
              <button type="button" className="ghostBtn" onClick={() => void loadLines()}>
                ↻
              </button>
              {canWrite && onAddCatalogItem ? (
                <button type="button" className="primaryBtn" onClick={onAddCatalogItem}>
                  + Добавить
                </button>
              ) : null}
            </>
          }
        />
        {loading && <p className="muted">Загрузка расходников...</p>}
        {!loading && !lines.length && <p className="muted">Расходники для инструмента не найдены.</p>}
        {!loading && lines.length > 0 && (
          <>
            <p className="muted" style={{ margin: "8px 0" }}>
              Клик по строке — карточка расходника. Б/у (старые) строки выше — их рекомендуется выдавать первыми.
            </p>
            <ToolConsumableListTable
              lines={lines}
              selectedKey={selectedKey}
              onOpen={(line) => setSelectedKey(line.key)}
              safeName={safeName}
            />
          </>
        )}
      </div>

      {selectedLine ? (
        <ToolConsumableDrawer
          line={selectedLine}
          canWrite={Boolean(canWrite)}
          safeName={safeName}
          onClose={() => setSelectedKey(null)}
          onIssue={() => setIssueLine(selectedLine)}
        />
      ) : null}

      {issueLine ? (
        <ToolConsumableIssueModal
          open={Boolean(issueLine)}
          line={issueLine}
          recipientSuggestions={recipientSuggestions}
          submitting={issueSubmitting}
          onClose={() => setIssueLine(null)}
          onSubmit={submitIssue}
        />
      ) : null}
    </>
  );
}
