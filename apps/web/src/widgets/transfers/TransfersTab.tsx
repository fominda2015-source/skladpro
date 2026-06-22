import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../../app/constants";
import { ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { PageHero } from "../ui/PageHero";
import { ToolsListToolbar } from "../tools/ToolsListToolbar";
import { MobileCard, MobileCardActions, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";
import { MATERIAL_QTY_STEP, parseMaterialQty } from "../../shared/quantity";

type Warehouse = { id: string; name: string };

type PeerStockRow = {
  materialId: string;
  materialName: string;
  unit: string;
  kind: string;
  quantity: number;
  reserved: number;
  available: number;
  limitNodeId: string | null;
};

type PeerWarehouse = {
  warehouseId: string;
  warehouseName: string;
  stocks: PeerStockRow[];
  tools: { total: number; inStock: number; issued: number; inRepair: number };
  campItems: number;
};

type TransferLine = {
  materialId: string;
  quantity: number;
  limitNodeId: string | null;
  materialName: string;
  unit: string;
};

type TransferRow = {
  id: string;
  number: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  section: string;
  requestedById: string;
  requesterName: string | null;
  status: string;
  note: string | null;
  documentCount: number;
  createdAt: string;
  lines: TransferLine[];
};

type DocFile = {
  id: string;
  fileName: string;
  filePath: string;
  type: string;
  createdAt: string;
};

type Props = {
  token: string | null;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  meId: string;
  toWarehouseId: string;
  section: "SS" | "EOM";
  warehouses: Warehouse[];
  canWrite: boolean;
  safeName: (n: string) => string;
  waybillsSlot?: React.ReactNode;
};

type SubTab = "request" | "send" | "approve" | "incoming" | "waybills";
type MaterialKindFilter = "" | "MATERIAL" | "CONSUMABLE" | "WORKWEAR";

const KIND_LABEL: Record<string, string> = {
  MATERIAL: "Материал",
  CONSUMABLE: "Расходник",
  WORKWEAR: "СИЗ"
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "Новая",
  APPROVED: "Согласована",
  REJECTED: "Отклонена",
  DONE: "Принята",
  CANCELLED: "Отменена"
};

function statusTone(status: string): "ok" | "warn" | "bad" | "neutral" {
  if (status === "DONE") return "ok";
  if (status === "APPROVED") return "warn";
  if (status === "REJECTED" || status === "CANCELLED") return "bad";
  return "neutral";
}

export function TransfersTab({
  token,
  fetchWithSession,
  meId,
  toWarehouseId,
  section,
  warehouses,
  canWrite,
  safeName,
  waybillsSlot
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>("request");
  const [peerData, setPeerData] = useState<PeerWarehouse[]>([]);
  const [peerLoading, setPeerLoading] = useState(false);
  const [peerError, setPeerError] = useState("");
  const [expandedWh, setExpandedWh] = useState<string | null>(null);
  const [requestSearch, setRequestSearch] = useState("");
  const [filterWarehouseId, setFilterWarehouseId] = useState("");
  const [filterKind, setFilterKind] = useState<MaterialKindFilter>("");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [selected, setSelected] = useState<Record<string, { qty: number; limitNodeId: string | null }>>({});
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [receiveDocs, setReceiveDocs] = useState<DocFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const [ownStocks, setOwnStocks] = useState<PeerStockRow[]>([]);
  const [ownLoading, setOwnLoading] = useState(false);
  const [ownError, setOwnError] = useState("");
  const [sendSearch, setSendSearch] = useState("");
  const [sendKind, setSendKind] = useState<MaterialKindFilter>("");
  const [sendOnlyAvailable, setSendOnlyAvailable] = useState(true);
  const [sendSelected, setSendSelected] = useState<Record<string, { qty: number; limitNodeId: string | null }>>({});
  const [sendNote, setSendNote] = useState("");
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendDestinationId, setSendDestinationId] = useState("");
  const [sendSubmitting, setSendSubmitting] = useState(false);

  const loadTransfers = useCallback(async () => {
    if (!token) return;
    setTransfersLoading(true);
    try {
      const res = await fetchWithSession(`${API_URL}/api/transfer-requests`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setTransfers((await res.json()) as TransferRow[]);
    } finally {
      setTransfersLoading(false);
    }
  }, [token, fetchWithSession]);

  const loadPeer = useCallback(async () => {
    if (!token || !toWarehouseId) return;
    setPeerLoading(true);
    setPeerError("");
    try {
      const res = await fetchWithSession(
        `${API_URL}/api/transfer-requests/peer-inventory?toWarehouseId=${encodeURIComponent(toWarehouseId)}&section=${section}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        setPeerError("Не удалось загрузить остатки других объектов");
        setPeerData([]);
        return;
      }
      const body = (await res.json()) as { warehouses: PeerWarehouse[] };
      setPeerData(body.warehouses ?? []);
      if (body.warehouses?.length) {
        setFilterWarehouseId((prev) => prev || body.warehouses![0].warehouseId);
        setExpandedWh(body.warehouses![0].warehouseId);
      }
    } catch {
      setPeerError("Ошибка сети");
    } finally {
      setPeerLoading(false);
    }
  }, [token, fetchWithSession, toWarehouseId, section]);

  const loadOwn = useCallback(async () => {
    if (!token || !toWarehouseId) return;
    setOwnLoading(true);
    setOwnError("");
    try {
      const res = await fetchWithSession(
        `${API_URL}/api/transfer-requests/own-inventory?fromWarehouseId=${encodeURIComponent(toWarehouseId)}&section=${section}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        setOwnError("Не удалось загрузить остатки вашего объекта");
        setOwnStocks([]);
        return;
      }
      const body = (await res.json()) as { stocks: PeerStockRow[] };
      setOwnStocks(body.stocks ?? []);
    } catch {
      setOwnError("Ошибка сети");
    } finally {
      setOwnLoading(false);
    }
  }, [token, fetchWithSession, toWarehouseId, section]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  useEffect(() => {
    if (subTab === "request" || subTab === "send") void loadPeer();
  }, [subTab, loadPeer]);

  useEffect(() => {
    if (subTab === "send") void loadOwn();
  }, [subTab, loadOwn]);

  const destinationWarehouses = useMemo(() => {
    const fromPeers = peerData.map((w) => ({ id: w.warehouseId, name: w.warehouseName }));
    if (fromPeers.length) return fromPeers;
    return warehouses.filter((w) => w.id !== toWarehouseId);
  }, [peerData, warehouses, toWarehouseId]);

  const outgoingRows = useMemo(
    () =>
      transfers.filter(
        (t) =>
          t.fromWarehouseId === toWarehouseId && (t.status === "NEW" || t.status === "APPROVED")
      ),
    [transfers, toWarehouseId]
  );
  const incoming = useMemo(
    () => transfers.filter((t) => t.toWarehouseId === toWarehouseId),
    [transfers, toWarehouseId]
  );
  const historyIncoming = useMemo(
    () => incoming.filter((t) => t.status === "DONE" || t.status === "REJECTED" || t.status === "CANCELLED"),
    [incoming]
  );

  const filteredPeerData = useMemo(() => {
    const q = requestSearch.trim().toLowerCase();
    const hasStockFilters = Boolean(q || filterKind || onlyAvailable);
    const sourceId = filterWarehouseId;

    return peerData
      .filter((wh) => !sourceId || wh.warehouseId === sourceId)
      .map((wh) => {
        const stocks = wh.stocks.filter((row) => {
          if (filterKind && row.kind !== filterKind) return false;
          if (onlyAvailable && row.available <= 0) return false;
          if (!q) return true;
          return (
            row.materialName.toLowerCase().includes(q) ||
            wh.warehouseName.toLowerCase().includes(q) ||
            row.unit.toLowerCase().includes(q)
          );
        });
        return { ...wh, stocks };
      })
      .filter((wh) => {
        if (wh.stocks.length > 0) return true;
        if (sourceId && wh.warehouseId === sourceId) return true;
        return !hasStockFilters;
      });
  }, [peerData, requestSearch, filterWarehouseId, filterKind, onlyAvailable]);

  const filteredSendStocks = useMemo(() => {
    const q = sendSearch.trim().toLowerCase();
    return ownStocks.filter((row) => {
      if (sendKind && row.kind !== sendKind) return false;
      if (sendOnlyAvailable && row.available <= 0) return false;
      if (!q) return true;
      return row.materialName.toLowerCase().includes(q) || row.unit.toLowerCase().includes(q);
    });
  }, [ownStocks, sendSearch, sendKind, sendOnlyAvailable]);

  const sendSelectedLines = useMemo(() => {
    const lines: Array<{ materialId: string; quantity: number; limitNodeId: string | null; label: string }> = [];
    for (const [materialId, v] of Object.entries(sendSelected)) {
      if (v.qty <= 0) continue;
      const row = ownStocks.find((s) => s.materialId === materialId);
      if (!row) continue;
      lines.push({
        materialId,
        quantity: v.qty,
        limitNodeId: v.limitNodeId,
        label: `${row.materialName} · ${v.qty} ${row.unit}`
      });
    }
    return lines;
  }, [sendSelected, ownStocks]);

  const filteredStockCount = useMemo(
    () => filteredPeerData.reduce((n, wh) => n + wh.stocks.length, 0),
    [filteredPeerData]
  );

  useEffect(() => {
    if (subTab !== "request") return;
    if (filterWarehouseId) setFromWarehouseId(filterWarehouseId);
  }, [subTab, filterWarehouseId]);

  const selectedLines = useMemo(() => {
    const lines: Array<{ materialId: string; quantity: number; limitNodeId: string | null; label: string }> = [];
    for (const [key, v] of Object.entries(selected)) {
      if (v.qty <= 0) continue;
      const [whId, materialId] = key.split(":");
      const wh = peerData.find((w) => w.warehouseId === whId);
      const row = wh?.stocks.find((s) => s.materialId === materialId);
      if (!row) continue;
      lines.push({
        materialId,
        quantity: v.qty,
        limitNodeId: v.limitNodeId,
        label: `${row.materialName} · ${v.qty} ${row.unit}`
      });
    }
    return lines;
  }, [selected, peerData]);

  const toggleRow = (whId: string, row: PeerStockRow, checked: boolean) => {
    const key = `${whId}:${row.materialId}`;
    setSelected((prev) => {
      const next = { ...prev };
      if (!checked) {
        delete next[key];
        return next;
      }
      next[key] = {
        qty: Math.min(row.available, prev[key]?.qty ?? row.available) || row.available,
        limitNodeId: row.limitNodeId
      };
      return next;
    });
    if (checked && !fromWarehouseId) setFromWarehouseId(whId);
  };

  const setRowQty = (whId: string, materialId: string, qty: number, limitNodeId: string | null, max: number) => {
    const key = `${whId}:${materialId}`;
    const safe = Math.max(0, Math.min(max, Math.round(qty)));
    setSelected((prev) => {
      if (safe <= 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { qty: safe, limitNodeId } };
    });
  };

  async function submitRequest() {
    if (!token || !canWrite || submitting) return;
    const senderId = filterWarehouseId || fromWarehouseId;
    if (!senderId || senderId === toWarehouseId) {
      setMessage("Выберите объект-отправитель (другой объект, не текущий)");
      return;
    }
    const lines = selectedLines.map((l) => ({
      materialId: l.materialId,
      quantity: l.quantity,
      limitNodeId: l.limitNodeId ?? undefined
    }));
    if (!lines.length) {
      setMessage("Отметьте позиции и укажите количество");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${API_URL}/api/transfer-requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWarehouseId: senderId,
          toWarehouseId,
          section,
          note: note.trim() || undefined,
          lines
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(typeof body.error === "string" ? body.error : "Не удалось создать заявку");
        return;
      }
      setMessage("Заявка отправлена. Ответственные на объекте-отправителе получат уведомление и сообщение в чат «Помощник».");
      setSelected({});
      setNote("");
      await loadTransfers();
      await loadPeer();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSend() {
    if (!token || !canWrite || sendSubmitting || !toWarehouseId) return;
    if (!sendDestinationId || sendDestinationId === toWarehouseId) {
      setMessage("Выберите объект-получатель");
      return;
    }
    const lines = sendSelectedLines.map((l) => ({
      materialId: l.materialId,
      quantity: l.quantity,
      limitNodeId: l.limitNodeId ?? undefined
    }));
    if (!lines.length) {
      setMessage("Отметьте позиции для отправки");
      return;
    }
    setSendSubmitting(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${API_URL}/api/transfer-requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWarehouseId: toWarehouseId,
          toWarehouseId: sendDestinationId,
          section,
          note: sendNote.trim() || undefined,
          lines
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(typeof body.error === "string" ? body.error : "Не удалось создать перемещение");
        return;
      }
      setMessage("Перемещение создано. Согласуйте на вкладке «Согласование» или дождитесь приёмки на объекте-получателе.");
      setSendSelected({});
      setSendNote("");
      setSendModalOpen(false);
      setSendDestinationId("");
      await loadTransfers();
      await loadOwn();
    } finally {
      setSendSubmitting(false);
    }
  }

  const toggleSendRow = (row: PeerStockRow, checked: boolean) => {
    const key = row.materialId;
    setSendSelected((prev) => {
      const next = { ...prev };
      if (!checked) {
        delete next[key];
        return next;
      }
      next[key] = {
        qty: Math.min(row.available, prev[key]?.qty ?? row.available) || row.available,
        limitNodeId: row.limitNodeId
      };
      return next;
    });
  };

  const setSendRowQty = (materialId: string, qty: number, limitNodeId: string | null, max: number) => {
    const safe = Math.max(0, Math.min(max, Math.round(qty)));
    setSendSelected((prev) => {
      if (safe <= 0) {
        const next = { ...prev };
        delete next[materialId];
        return next;
      }
      return { ...prev, [materialId]: { qty: safe, limitNodeId } };
    });
  };

  async function patchStatus(id: string, status: string) {
    if (!token || !canWrite) return;
    const res = await fetchWithSession(`${API_URL}/api/transfer-requests/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(typeof body.error === "string" ? body.error : "Не удалось обновить статус");
      return;
    }
    setMessage("");
    await loadTransfers();
    if (receiveId === id) await loadReceiveDocs(id);
  }

  async function loadReceiveDocs(id: string) {
    if (!token) return;
    const res = await fetchWithSession(
      `${API_URL}/api/documents?entityType=transferrequest&entityId=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) setReceiveDocs((await res.json()) as DocFile[]);
  }

  async function uploadAct(id: string, file: File) {
    if (!token || !canWrite) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entityType", "transferrequest");
      fd.append("entityId", id);
      fd.append("type", "transfer_act");
      const res = await fetchWithSession(`${API_URL}/api/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) {
        setMessage("Не удалось загрузить акт");
        return;
      }
      await loadReceiveDocs(id);
      await loadTransfers();
    } finally {
      setUploading(false);
    }
  }

  const openReceive = (id: string) => {
    setReceiveId(id);
    void loadReceiveDocs(id);
  };

  return (
    <div className="transfersWorkspace">
      <PageHero
        variant="compact"
        icon="↔"
        title="Перемещения"
        subtitle="Запрос с других объектов · отправка со своего · приём с актом"
        stats={[
          { label: "Заявок", value: transfers.length, tone: "neutral" },
          {
            label: "К приёму",
            value: incoming.filter((t) => t.status === "APPROVED").length,
            tone: incoming.some((t) => t.status === "APPROVED") ? "warn" : "neutral"
          }
        ]}
        actions={
          <button type="button" className="ghostBtn" onClick={() => void loadTransfers()}>
            ↻ Обновить
          </button>
        }
      />

      <nav className="transfersSubNav" aria-label="Разделы перемещений">
        <button type="button" className={subTab === "request" ? "active" : ""} onClick={() => setSubTab("request")}>
          Запросить
        </button>
        <button type="button" className={subTab === "send" ? "active" : ""} onClick={() => setSubTab("send")}>
          Отправить
        </button>
        <button type="button" className={subTab === "approve" ? "active" : ""} onClick={() => setSubTab("approve")}>
          Согласование
        </button>
        <button type="button" className={subTab === "incoming" ? "active" : ""} onClick={() => setSubTab("incoming")}>
          Принять
        </button>
        {waybillsSlot ? (
          <button type="button" className={subTab === "waybills" ? "active" : ""} onClick={() => setSubTab("waybills")}>
            ТН
          </button>
        ) : null}
      </nav>

      {message ? <p className="muted transfersMessage">{message}</p> : null}

      {subTab === "request" ? (
        <div className="transfersPanel">
          {!toWarehouseId ? (
            <p className="muted">Выберите объект-получатель в шапке приложения.</p>
          ) : (
            <>
              <p className="muted transfersHint">
                Раздел {section === "SS" ? "СС" : "ЭОМ"} · ваш объект (получатель):{" "}
                <strong>{safeName(warehouses.find((w) => w.id === toWarehouseId)?.name ?? "")}</strong>.
                Выберите объект-отправитель и отметьте нужные позиции с его склада.
              </p>

              <ToolsListToolbar
                search={requestSearch}
                onSearchChange={setRequestSearch}
                searchPlaceholder="Поиск: материал, единица…"
                filters={
                  <>
                    <label>
                      С какого объекта смотрим остатки
                      <select
                        value={filterWarehouseId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setFilterWarehouseId(id);
                          setSelected({});
                          setExpandedWh(id || null);
                        }}
                        aria-label="Объект-отправитель"
                        required
                      >
                        <option value="" disabled>
                          — выберите объект —
                        </option>
                        {peerData.map((w) => (
                          <option key={w.warehouseId} value={w.warehouseId}>
                            {safeName(w.warehouseName)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Вид ТМЦ
                      <select
                        value={filterKind}
                        onChange={(e) => setFilterKind((e.target.value || "") as MaterialKindFilter)}
                        aria-label="Вид материала"
                      >
                        <option value="">Все виды</option>
                        <option value="MATERIAL">{KIND_LABEL.MATERIAL}</option>
                        <option value="CONSUMABLE">{KIND_LABEL.CONSUMABLE}</option>
                        <option value="WORKWEAR">{KIND_LABEL.WORKWEAR}</option>
                      </select>
                    </label>
                    <label className="transfersFilterCheck">
                      <input
                        type="checkbox"
                        checked={onlyAvailable}
                        onChange={(e) => setOnlyAvailable(e.target.checked)}
                      />
                      Только с доступным остатком
                    </label>
                  </>
                }
                actions={
                  <button
                    type="button"
                    className="ghostBtn"
                    onClick={() => {
                      setRequestSearch("");
                      setFilterKind("");
                      setOnlyAvailable(true);
                    }}
                  >
                    Сбросить
                  </button>
                }
              />

              {!peerLoading && !peerError && filterWarehouseId ? (
                <p className="muted transfersFilterSummary">
                  Показано {filteredStockCount} позиций
                  {filterWarehouseId
                    ? ` · ${safeName(peerData.find((w) => w.warehouseId === filterWarehouseId)?.warehouseName ?? "")}`
                    : ""}
                </p>
              ) : null}

              {peerLoading ? <LoadingState text="Загружаем остатки…" /> : null}
              {peerError ? <ErrorState text={peerError} /> : null}
              {!peerLoading && !peerError && !filterWarehouseId ? (
                <p className="muted">Выберите объект-отправитель в списке выше.</p>
              ) : null}
              {!peerLoading && !peerError && filterWarehouseId && filteredPeerData.length === 0 ? (
                <p className="muted">По фильтрам ничего не найдено. Измените условия или сбросьте фильтры.</p>
              ) : null}
              {!peerLoading && !peerError && filteredPeerData.length > 0 ? (
                <div className="transfersPeerList">
                  {filteredPeerData.map((wh) => {
                    const open = expandedWh === wh.warehouseId;
                    return (
                      <section key={wh.warehouseId} className="transfersPeerCard card">
                        <button
                          type="button"
                          className="transfersPeerCardHead"
                          onClick={() => setExpandedWh(open ? null : wh.warehouseId)}
                        >
                          <strong>{safeName(wh.warehouseName)}</strong>
                          <span className="muted">
                            ТМЦ {wh.stocks.length} · городок {wh.campItems} · инструменты {wh.tools.total} (склад{" "}
                            {wh.tools.inStock})
                          </span>
                          <span className="transfersPeerChevron">{open ? "▾" : "▸"}</span>
                        </button>
                        {open ? (
                          <div className="transfersPeerCardBody">
                            {wh.stocks.length === 0 ? (
                              <p className="muted">Нет остатков ТМЦ в этом разделе.</p>
                            ) : (
                              <div className="erpTableWrap">
                                <table className="erpTable desktopTable transfersPickTable">
                                  <thead>
                                    <tr>
                                      <th style={{ width: 36 }} />
                                      <th>Материал</th>
                                      <th>Доступно</th>
                                      <th style={{ width: 100 }}>Запросить</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {wh.stocks.map((row) => {
                                      const key = `${wh.warehouseId}:${row.materialId}`;
                                      const sel = selected[key];
                                      return (
                                        <tr key={key}>
                                          <td>
                                            <input
                                              type="checkbox"
                                              checked={Boolean(sel)}
                                              disabled={!canWrite || row.available <= 0}
                                              onChange={(e) => toggleRow(wh.warehouseId, row, e.target.checked)}
                                            />
                                          </td>
                                          <td>
                                            {row.materialName}
                                            <span className="muted">
                                              {" "}
                                              · {row.unit}
                                              {row.kind && row.kind !== "MATERIAL"
                                                ? ` · ${KIND_LABEL[row.kind] ?? row.kind}`
                                                : ""}
                                            </span>
                                          </td>
                                          <td className="muted">
                                            {row.available.toLocaleString("ru-RU")}
                                            {row.reserved > 0 ? ` (резерв ${row.reserved})` : ""}
                                          </td>
                                          <td>
                                            <input
                                              type="number"
                                              min={0}
                                              max={row.available}
                                              step={MATERIAL_QTY_STEP}
                                              disabled={!sel || !canWrite}
                                              value={sel?.qty ?? ""}
                                              onChange={(e) =>
                                                setRowQty(
                                                  wh.warehouseId,
                                                  row.materialId,
                                                  parseMaterialQty(e.target.value),
                                                  row.limitNodeId,
                                                  row.available
                                                )
                                              }
                                            />
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              ) : null}

              {canWrite && selectedLines.length > 0 ? (
                <footer className="transfersRequestBar card">
                  <label>
                    Комментарий
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" />
                  </label>
                  <div className="transfersRequestSummary">
                    <span className="muted">
                      С {safeName(peerData.find((w) => w.warehouseId === filterWarehouseId)?.warehouseName ?? "")} ·
                      позиций: {selectedLines.length}
                    </span>
                    <ul>
                      {selectedLines.map((l) => (
                        <li key={l.materialId}>{l.label}</li>
                      ))}
                    </ul>
                  </div>
                  <button type="button" className="primaryBtn" disabled={submitting} onClick={() => void submitRequest()}>
                    {submitting ? "Отправка…" : "Отправить заявку"}
                  </button>
                </footer>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {subTab === "send" ? (
        <div className="transfersPanel">
          {!toWarehouseId ? (
            <p className="muted">Выберите объект в шапке приложения.</p>
          ) : (
            <>
              <p className="muted transfersHint">
                Раздел {section === "SS" ? "СС" : "ЭОМ"} · отправитель:{" "}
                <strong>{safeName(warehouses.find((w) => w.id === toWarehouseId)?.name ?? "")}</strong>. Отметьте
                позиции со своего склада и нажмите «Отправить» — выберите объект-получатель.
              </p>
              <ToolsListToolbar
                search={sendSearch}
                onSearchChange={setSendSearch}
                searchPlaceholder="Поиск: материал, единица…"
                filters={
                  <>
                    <label>
                      Вид ТМЦ
                      <select
                        value={sendKind}
                        onChange={(e) => setSendKind((e.target.value || "") as MaterialKindFilter)}
                        aria-label="Вид материала"
                      >
                        <option value="">Все виды</option>
                        <option value="MATERIAL">{KIND_LABEL.MATERIAL}</option>
                        <option value="CONSUMABLE">{KIND_LABEL.CONSUMABLE}</option>
                        <option value="WORKWEAR">{KIND_LABEL.WORKWEAR}</option>
                      </select>
                    </label>
                    <label className="transfersFilterCheck">
                      <input
                        type="checkbox"
                        checked={sendOnlyAvailable}
                        onChange={(e) => setSendOnlyAvailable(e.target.checked)}
                      />
                      Только с доступным остатком
                    </label>
                  </>
                }
                actions={
                  <button
                    type="button"
                    className="ghostBtn"
                    onClick={() => {
                      setSendSearch("");
                      setSendKind("");
                      setSendOnlyAvailable(true);
                    }}
                  >
                    Сбросить
                  </button>
                }
              />
              {ownLoading ? <LoadingState text="Загружаем остатки…" /> : null}
              {ownError ? <ErrorState text={ownError} /> : null}
              {!ownLoading && !ownError ? (
                <div className="card transfersPeerCardBody" style={{ marginTop: 8 }}>
                  {filteredSendStocks.length === 0 ? (
                    <p className="muted">Нет позиций по фильтрам.</p>
                  ) : (
                    <div className="erpTableWrap">
                      <table className="erpTable desktopTable transfersPickTable">
                        <thead>
                          <tr>
                            <th style={{ width: 36 }} />
                            <th>Материал</th>
                            <th>Доступно</th>
                            <th style={{ width: 100 }}>Кол-во</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSendStocks.map((row) => {
                            const sel = sendSelected[row.materialId];
                            return (
                              <tr key={row.materialId}>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(sel)}
                                    disabled={!canWrite || row.available <= 0}
                                    onChange={(e) => toggleSendRow(row, e.target.checked)}
                                  />
                                </td>
                                <td>
                                  {row.materialName}
                                  <span className="muted">
                                    {" "}
                                    · {row.unit}
                                    {row.kind && row.kind !== "MATERIAL"
                                      ? ` · ${KIND_LABEL[row.kind] ?? row.kind}`
                                      : ""}
                                  </span>
                                </td>
                                <td className="muted">
                                  {row.available.toLocaleString("ru-RU")}
                                  {row.reserved > 0 ? ` (резерв ${row.reserved})` : ""}
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min={0}
                                    max={row.available}
                                    step={MATERIAL_QTY_STEP}
                                    disabled={!sel || !canWrite}
                                    value={sel?.qty ?? ""}
                                    onChange={(e) =>
                                      setSendRowQty(
                                        row.materialId,
                                        parseMaterialQty(e.target.value),
                                        row.limitNodeId,
                                        row.available
                                      )
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
              {canWrite && sendSelectedLines.length > 0 ? (
                <footer className="transfersRequestBar card">
                  <div className="transfersRequestSummary">
                    <span className="muted">К отправке: {sendSelectedLines.length} поз.</span>
                    <ul>
                      {sendSelectedLines.map((l) => (
                        <li key={l.materialId}>{l.label}</li>
                      ))}
                    </ul>
                  </div>
                  <button
                    type="button"
                    className="primaryBtn"
                    onClick={() => {
                      setSendDestinationId(destinationWarehouses[0]?.id ?? "");
                      setSendModalOpen(true);
                    }}
                  >
                    Отправить…
                  </button>
                </footer>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {sendModalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={() => setSendModalOpen(false)}>
          <div className="modalCard" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Куда отправить</h3>
            <p className="muted">
              С объекта «{safeName(warehouses.find((w) => w.id === toWarehouseId)?.name ?? "")}» · раздел{" "}
              {section === "SS" ? "СС" : "ЭОМ"}
            </p>
            <label>
              Объект-получатель
              <select
                value={sendDestinationId}
                onChange={(e) => setSendDestinationId(e.target.value)}
                aria-label="Объект-получатель"
              >
                <option value="">— выберите —</option>
                {destinationWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {safeName(w.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Комментарий
              <input
                value={sendNote}
                onChange={(e) => setSendNote(e.target.value)}
                placeholder="Необязательно"
              />
            </label>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button type="button" className="ghostBtn" onClick={() => setSendModalOpen(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="primaryBtn"
                disabled={sendSubmitting || !sendDestinationId}
                onClick={() => void submitSend()}
              >
                {sendSubmitting ? "Отправка…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {subTab === "approve" ? (
        <div className="transfersPanel card">
          <h3>Согласование исходящих</h3>
          <p className="muted">
            Заявки, где текущий объект — отправитель ({safeName(warehouses.find((w) => w.id === toWarehouseId)?.name ?? "")}).
            При согласовании остаток резервируется; приём — на вкладке «Принять» у получателя.
          </p>
          {transfersLoading ? <LoadingState text="Загрузка…" /> : null}
          <TransferTable
            rows={outgoingRows}
            meId={meId}
            canWrite={canWrite}
            mode="outgoing"
            safeName={safeName}
            onPatch={patchStatus}
          />
        </div>
      ) : null}

      {subTab === "incoming" ? (
        <div className="transfersPanel">
          <div className="card">
            <h3>Принять перемещение</h3>
            <p className="muted">
              Согласованные заявки на ваш объект ({safeName(warehouses.find((w) => w.id === toWarehouseId)?.name ?? "")}).
              Прикрепите акт перемещения, затем нажмите «Принять» — остатки переносятся автоматически.
            </p>
            {transfersLoading ? <LoadingState text="Загрузка…" /> : null}
            <TransferTable
              rows={incoming.filter((t) => t.status === "APPROVED")}
              meId={meId}
              canWrite={canWrite}
              mode="incoming"
              safeName={safeName}
              onPatch={patchStatus}
              onReceiveOpen={openReceive}
              receiveId={receiveId}
            />
          </div>

          {receiveId ? (
            <div className="card transfersReceiveDetail">
              <h4>Акты и приём · {receiveId.slice(0, 8)}…</h4>
              <label className="transfersUploadLabel">
                <span className="primaryBtn">+ Прикрепить акт</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                  disabled={uploading || !canWrite}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = "";
                    void (async () => {
                      for (const f of files) await uploadAct(receiveId, f);
                    })();
                  }}
                />
              </label>
              {receiveDocs.length === 0 ? (
                <p className="muted">Актов пока нет — загрузите перед приёмом.</p>
              ) : (
                <ul className="transfersDocList">
                  {receiveDocs.map((d) => (
                    <li key={d.id}>
                      <a href={`${API_URL}/${d.filePath}`} target="_blank" rel="noreferrer">
                        {d.fileName}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {canWrite ? (
                <button
                  type="button"
                  className="primaryBtn"
                  disabled={receiveDocs.length < 1}
                  onClick={() => void patchStatus(receiveId, "DONE")}
                >
                  Принять перемещение
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="card" style={{ marginTop: 12 }}>
            <h3>История приёмов</h3>
            <TransferTable
              rows={historyIncoming}
              meId={meId}
              canWrite={false}
              mode="history"
              safeName={safeName}
              onPatch={patchStatus}
            />
          </div>
        </div>
      ) : null}

      {subTab === "waybills" && waybillsSlot ? <div className="transfersPanel">{waybillsSlot}</div> : null}
    </div>
  );
}

function TransferTable({
  rows,
  meId,
  canWrite,
  mode,
  safeName,
  onPatch,
  onReceiveOpen,
  receiveId
}: {
  rows: TransferRow[];
  meId: string;
  canWrite: boolean;
  mode: "outgoing" | "incoming" | "history";
  safeName: (n: string) => string;
  onPatch: (id: string, status: string) => void | Promise<void>;
  onReceiveOpen?: (id: string) => void;
  receiveId?: string | null;
}) {
  if (!rows.length) return <p className="muted">Заявок нет.</p>;
  return (
    <ResponsiveTableShell>
    <div className="erpTableWrap">
      <table className="erpTable desktopTable">
        <thead>
          <tr>
            <th>Номер</th>
            <th>Статус</th>
            <th>Маршрут</th>
            <th>Состав</th>
            {mode !== "history" ? <th>Действия</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((tr) => (
            <tr key={tr.id} className={receiveId === tr.id ? "active" : undefined}>
              <td>
                <strong>{tr.number}</strong>
              </td>
              <td>
                <StatusBadge tone={statusTone(tr.status)}>{STATUS_LABEL[tr.status] ?? tr.status}</StatusBadge>
              </td>
              <td>
                {safeName(tr.fromWarehouseName || "")} → {safeName(tr.toWarehouseName || "")} · {tr.section}
              </td>
              <td>
                {tr.lines.map((ln) => (
                  <div key={`${tr.id}-${ln.materialId}`}>
                    {ln.materialName} · {ln.quantity} {ln.unit}
                  </div>
                ))}
              </td>
              {mode !== "history" ? (
                <td>
                  <div className="transfersRowActions">
                    {mode === "outgoing" && tr.status === "NEW" && canWrite ? (
                      <>
                        <button type="button" className="primaryBtn" onClick={() => void onPatch(tr.id, "APPROVED")}>
                          Согласовать
                        </button>
                        <button type="button" className="ghostBtn" onClick={() => void onPatch(tr.id, "REJECTED")}>
                          Отказать
                        </button>
                      </>
                    ) : null}
                    {mode === "outgoing" && tr.status === "NEW" && tr.requestedById === meId ? (
                      <button type="button" className="ghostBtn" onClick={() => void onPatch(tr.id, "CANCELLED")}>
                        Отменить
                      </button>
                    ) : null}
                    {mode === "incoming" && tr.status === "APPROVED" && canWrite ? (
                      <button type="button" className="ghostBtn" onClick={() => onReceiveOpen?.(tr.id)}>
                        Акт и приём
                      </button>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="mobileCards">
      {rows.map((tr) => (
        <MobileCard key={`m-${tr.id}`}>
          <h4>{tr.number}</h4>
          <MobileCardField label="Статус">
            <StatusBadge tone={statusTone(tr.status)}>{STATUS_LABEL[tr.status] ?? tr.status}</StatusBadge>
          </MobileCardField>
          <MobileCardField label="Маршрут">
            {safeName(tr.fromWarehouseName || "")} → {safeName(tr.toWarehouseName || "")} · {tr.section}
          </MobileCardField>
          <MobileCardField label="Состав">
            {tr.lines.map((ln) => (
              <div key={`${tr.id}-${ln.materialId}`}>
                {ln.materialName} · {ln.quantity} {ln.unit}
              </div>
            ))}
          </MobileCardField>
          {mode !== "history" ? (
            <MobileCardActions>
              {mode === "outgoing" && tr.status === "NEW" && canWrite ? (
                <>
                  <button type="button" className="primaryBtn" onClick={() => void onPatch(tr.id, "APPROVED")}>
                    Согласовать
                  </button>
                  <button type="button" className="ghostBtn" onClick={() => void onPatch(tr.id, "REJECTED")}>
                    Отказать
                  </button>
                </>
              ) : null}
              {mode === "outgoing" && tr.status === "NEW" && tr.requestedById === meId ? (
                <button type="button" className="ghostBtn" onClick={() => void onPatch(tr.id, "CANCELLED")}>
                  Отменить
                </button>
              ) : null}
              {mode === "incoming" && tr.status === "APPROVED" && canWrite ? (
                <button type="button" className="ghostBtn" onClick={() => onReceiveOpen?.(tr.id)}>
                  Акт и приём
                </button>
              ) : null}
            </MobileCardActions>
          ) : null}
        </MobileCard>
      ))}
    </div>
    </ResponsiveTableShell>
  );
}
