import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../../app/constants";
import { ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { PageHero } from "../ui/PageHero";

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

type SubTab = "request" | "outgoing" | "incoming" | "waybills";

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
        setExpandedWh((prev) => prev ?? body.warehouses![0].warehouseId);
      }
    } catch {
      setPeerError("Ошибка сети");
    } finally {
      setPeerLoading(false);
    }
  }, [token, fetchWithSession, toWarehouseId, section]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  useEffect(() => {
    if (subTab === "request") void loadPeer();
  }, [subTab, loadPeer]);

  const outgoingRows = useMemo(
    () => transfers.filter((t) => t.status === "NEW" || t.status === "APPROVED"),
    [transfers]
  );
  const incoming = useMemo(
    () => transfers.filter((t) => t.toWarehouseId === toWarehouseId),
    [transfers, toWarehouseId]
  );
  const historyIncoming = useMemo(
    () => incoming.filter((t) => t.status === "DONE" || t.status === "REJECTED" || t.status === "CANCELLED"),
    [incoming]
  );

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
    const safe = Math.max(0, Math.min(max, qty));
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
    if (!fromWarehouseId || fromWarehouseId === toWarehouseId) {
      setMessage("Выберите склад-отправитель (не текущий объект)");
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
          fromWarehouseId,
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
        subtitle="Запрос с других объектов · согласование · приём с актом"
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
        <button type="button" className={subTab === "outgoing" ? "active" : ""} onClick={() => setSubTab("outgoing")}>
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
                Раздел {section === "SS" ? "СС" : "ЭОМ"} · получатель:{" "}
                <strong>{safeName(warehouses.find((w) => w.id === toWarehouseId)?.name ?? "")}</strong>. Отметьте
                позиции на других складах и укажите количество не больше доступного (остаток минус резерв).
              </p>
              {peerLoading ? <LoadingState text="Загружаем остатки…" /> : null}
              {peerError ? <ErrorState text={peerError} /> : null}
              {!peerLoading && !peerError ? (
                <div className="transfersPeerList">
                  {peerData.map((wh) => {
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
                                            <span className="muted"> · {row.unit}</span>
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
                                              step={0.001}
                                              disabled={!sel || !canWrite}
                                              value={sel?.qty ?? ""}
                                              onChange={(e) =>
                                                setRowQty(
                                                  wh.warehouseId,
                                                  row.materialId,
                                                  Number(e.target.value),
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
                    Склад-отправитель
                    <select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>
                      {peerData.map((w) => (
                        <option key={w.warehouseId} value={w.warehouseId}>
                          {safeName(w.warehouseName)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Комментарий
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" />
                  </label>
                  <div className="transfersRequestSummary">
                    <span className="muted">Позиций: {selectedLines.length}</span>
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

      {subTab === "outgoing" ? (
        <div className="transfersPanel card">
          <h3>Согласование исходящих</h3>
          <p className="muted">Заявки, где ваш объект — отправитель. При согласовании остаток резервируется.</p>
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
              Согласованные заявки на ваш объект. Прикрепите акт перемещения, затем нажмите «Принять» — остатки
              переносятся автоматически.
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
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                  disabled={uploading || !canWrite}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadAct(receiveId, f);
                    e.target.value = "";
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
  );
}
