import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseMaterialQty } from "../../shared/quantity";
import { ToolsListToolbar } from "./ToolsListToolbar";
import { ToolConsumableActionModal, type ConsumableCardAction } from "./ToolConsumableActionModal";
import { ToolConsumableDrawer } from "./ToolConsumableDrawer";
import { ToolConsumableIssueModal } from "./ToolConsumableIssueModal";
import { ToolConsumableListTable } from "./ToolConsumableListTable";
import type { ToolCatalogConsumableDetail, ToolCatalogConsumableLine } from "./toolCatalog";

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
  /** Рендер карточки в колонке toolsWorkspace (как у инструментов). */
  onDrawerMount?: (drawer: ReactNode) => void;
};

export function ToolConsumablesCatalogSection({
  warehouseId,
  sectionFilter,
  token,
  apiUrl,
  fetchWithSession,
  canWrite,
  onCatalogMessage,
  catalogRefreshNonce = 0,
  recipientSuggestions,
  safeName,
  onDrawerOpenChange,
  onDrawerMount
}: Props) {
  const [lines, setLines] = useState<ToolCatalogConsumableLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ToolCatalogConsumableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [issueLine, setIssueLine] = useState<ToolCatalogConsumableLine | null>(null);
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [cardAction, setCardAction] = useState<{ action: ConsumableCardAction; line: ToolCatalogConsumableLine } | null>(
    null
  );
  const [actionSubmitting, setActionSubmitting] = useState(false);

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

  const loadDetail = useCallback(
    async (stockId: string) => {
      if (!token) return;
      setDetailLoading(true);
      try {
        const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/consumables/card/${stockId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) setDetail((await res.json()) as ToolCatalogConsumableDetail);
        else setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [token, apiUrl, fetchWithSession]
  );

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

  useEffect(() => {
    if (selectedLine?.stockId) void loadDetail(selectedLine.stockId);
    else setDetail(null);
  }, [selectedLine?.stockId, loadDetail, catalogRefreshNonce]);

  async function refreshAfterMutation(stockId?: string) {
    await loadLines();
    if (stockId) await loadDetail(stockId);
  }

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
      const sid = issueLine.stockId;
      await refreshAfterMutation(sid);
      const listQ = new URLSearchParams({
        section: "TOOL_CONSUMABLE",
        sectionFilter,
        splitByCondition: "1"
      });
      if (warehouseId) listQ.set("warehouseId", warehouseId);
      const still = (await fetchWithSession(`${apiUrl}/api/tools/catalog/materials?${listQ}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then((r) => (r.ok ? r.json() : []))) as ToolCatalogConsumableLine[];
      if (!still.some((l) => l.stockId === sid && l.quantity > 0)) setSelectedKey(null);
      return true;
    } finally {
      setIssueSubmitting(false);
    }
  }

  async function saveCard(
    stockId: string,
    patch: { name: string; unit: string; note: string; quantity: string }
  ) {
    if (!token) return false;
    setSaving(true);
    try {
      const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/consumables/card/${stockId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: patch.name.trim(),
          unit: patch.unit.trim(),
          note: patch.note.trim() || null,
          quantity: parseMaterialQty(patch.quantity)
        })
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        onCatalogMessage?.(err.error || "Не удалось сохранить", "error");
        return false;
      }
      onCatalogMessage?.("Карточка сохранена", "success");
      await refreshAfterMutation(stockId);
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function runCardAction(
    stockId: string,
    action: "WRITE_OFF" | "DISPUTE" | "CLEAR_DISPUTE",
    data: { comment: string; quantity?: number }
  ) {
    if (!token) return false;
    setActionSubmitting(true);
    try {
      const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/consumables/card/${stockId}/action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: data.comment || undefined, quantity: data.quantity })
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        onCatalogMessage?.(err.error || "Не удалось выполнить действие", "error");
        return false;
      }
      onCatalogMessage?.(
        action === "WRITE_OFF" ? "Расходник списан" : action === "DISPUTE" ? "Помечено спорным" : "Спор снят",
        "success"
      );
      setCardAction(null);
      await refreshAfterMutation(stockId);
      if (action === "WRITE_OFF") {
        const d = await fetchWithSession(`${apiUrl}/api/tools/catalog/consumables/card/${stockId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (d.ok) {
          const body = (await d.json()) as ToolCatalogConsumableDetail;
          if (body.quantity <= 0) setSelectedKey(null);
        }
      }
      return true;
    } finally {
      setActionSubmitting(false);
    }
  }

  async function deleteCard(stockId: string) {
    if (!token) return;
    setDeleting(true);
    try {
      const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/consumables/card/${stockId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok && res.status !== 204) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        onCatalogMessage?.(err.error || "Не удалось удалить карточку", "error");
        return;
      }
      onCatalogMessage?.("Карточка удалена", "success");
      setSelectedKey(null);
      setDetail(null);
      await loadLines();
    } finally {
      setDeleting(false);
    }
  }

  const drawerNode = useMemo(() => {
    if (!selectedLine && !detailLoading) return null;
    return (
      <ToolConsumableDrawer
        detail={detail}
        loading={detailLoading}
        canWrite={Boolean(canWrite)}
        saving={saving}
        deleting={deleting}
        safeName={safeName}
        onClose={() => {
          setSelectedKey(null);
          setDetail(null);
        }}
        onIssue={() => selectedLine && setIssueLine(selectedLine)}
        onSave={(patch) => (selectedLine ? saveCard(selectedLine.stockId, patch) : Promise.resolve(false))}
        onWriteOff={() => selectedLine && setCardAction({ action: "WRITE_OFF", line: selectedLine })}
        onDispute={() => selectedLine && setCardAction({ action: "DISPUTE", line: selectedLine })}
        onClearDispute={() =>
          selectedLine && void runCardAction(selectedLine.stockId, "CLEAR_DISPUTE", { comment: "Спор снят" })
        }
        onDelete={() => selectedLine && void deleteCard(selectedLine.stockId)}
        onRefreshEvents={() => selectedLine && void loadDetail(selectedLine.stockId)}
      />
    );
  }, [
    selectedLine,
    detailLoading,
    detail,
    saving,
    deleting,
    canWrite,
    safeName,
    loadDetail
  ]);

  useEffect(() => {
    if (!onDrawerMount) return;
    onDrawerMount(drawerNode);
    return () => onDrawerMount(null);
  }, [onDrawerMount, drawerNode]);

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
            </>
          }
        />
        {loading && <p className="muted">Загрузка расходников...</p>}
        {!loading && !lines.length && <p className="muted">Расходники для инструмента не найдены.</p>}
        {!loading && lines.length > 0 && (
          <>
            <p className="muted" style={{ margin: "8px 0" }}>
              Клик по строке — карточка расходника (редактирование, списание, спор, удаление). Б/у строки выше —
              выдавать первыми.
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

      {!onDrawerMount ? drawerNode : null}

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

      {cardAction ? (
        <ToolConsumableActionModal
          open={Boolean(cardAction)}
          action={cardAction.action}
          line={cardAction.line}
          submitting={actionSubmitting}
          onClose={() => setCardAction(null)}
          onSubmit={(data) => runCardAction(cardAction.line.stockId, cardAction.action, data)}
        />
      ) : null}
    </>
  );
}
