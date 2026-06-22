import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../app/constants";
import { ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { MATERIAL_QTY_MIN, MATERIAL_QTY_STEP, parseMaterialQty } from "../../shared/quantity";

type LimitNodeOption = {
  id: string;
  path: string;
  title: string;
  materialName: string | null;
  unit: string | null;
  plannedQty: number | null;
};

type BindingRow = {
  id: string;
  limitNodeId: string;
  path: string;
  limitMaterialName: string | null;
  limitUnit: string | null;
  quantity: number;
};

type Props = {
  token: string | null;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  warehouseId: string;
  section: "SS" | "EOM";
  materialId: string;
  materialName: string;
  materialUnit: string;
  canWrite: boolean;
  onClose: () => void;
};

export function WarehouseBindLimitModal({
  token,
  fetchWithSession,
  warehouseId,
  section,
  materialId,
  materialName,
  materialUnit,
  canWrite,
  onClose
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  const [limitNodes, setLimitNodes] = useState<LimitNodeOption[]>([]);
  const [limitNodeId, setLimitNodeId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ warehouseId, section, materialId });
      const [bindRes, nodesRes] = await Promise.all([
        fetchWithSession(`${API_URL}/api/material-limit-bindings?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetchWithSession(
          `${API_URL}/api/material-limit-bindings/limit-nodes?warehouseId=${encodeURIComponent(warehouseId)}&section=${section}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      ]);
      if (!bindRes.ok) throw new Error("Не удалось загрузить привязки");
      if (!nodesRes.ok) throw new Error("Не удалось загрузить лимиты");
      setBindings((await bindRes.json()) as BindingRow[]);
      const nodes = (await nodesRes.json()) as LimitNodeOption[];
      setLimitNodes(nodes);
      if (!limitNodeId && nodes.length) setLimitNodeId(nodes[0]!.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [token, fetchWithSession, warehouseId, section, materialId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBinding() {
    if (!token || !canWrite || saving || !limitNodeId) return;
    const qty = parseMaterialQty(quantity);
    if (qty <= 0) {
      setMessage("Укажите количество больше нуля");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${API_URL}/api/material-limit-bindings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          section,
          materialId,
          limitNodeId,
          quantity: qty
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(typeof body.error === "string" ? body.error : "Не удалось сохранить");
        return;
      }
      setQuantity(1);
      setMessage("Привязка сохранена");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function removeBinding(id: string) {
    if (!token || !canWrite) return;
    const res = await fetchWithSession(`${API_URL}/api/material-limit-bindings/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) await load();
  }

  const selectedNode = limitNodes.find((n) => n.id === limitNodeId);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modalCard warehouseBindLimitModal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Привязать к лимиту</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Материал склада: <strong>{materialName}</strong> ({materialUnit}) · раздел {section === "SS" ? "СС" : "ЭОМ"}
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          Приход, выдача и остаток по этому материалу будут учитываться в выбранной строке лимита. Коэффициент: 1 ед.
          склада → N ед. в лимите.
        </p>

        {loading ? <LoadingState text="Загрузка…" /> : null}
        {error ? <ErrorState text={error} /> : null}

        {!loading && !error ? (
          <>
            {bindings.length > 0 ? (
              <div className="warehouseBindLimitList card" style={{ marginBottom: 12 }}>
                <h4 style={{ margin: "0 0 8px" }}>Текущие привязки</h4>
                <ul className="warehouseBindLimitItems">
                  {bindings.map((b) => (
                    <li key={b.id}>
                      <span>
                        {b.path}
                        {b.limitMaterialName ? ` · ${b.limitMaterialName}` : ""}
                        <span className="muted"> · коэфф. {b.quantity}</span>
                      </span>
                      {canWrite ? (
                        <button type="button" className="ghostBtn" onClick={() => void removeBinding(b.id)}>
                          Удалить
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="muted">Пока нет привязок к лимиту.</p>
            )}

            {canWrite ? (
              <div className="form" style={{ marginTop: 12 }}>
                <label>
                  Строка лимита
                  <select value={limitNodeId} onChange={(e) => setLimitNodeId(e.target.value)}>
                    <option value="">— выберите —</option>
                    {limitNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.path}
                        {n.materialName ? ` · ${n.materialName}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedNode ? (
                  <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                    {selectedNode.plannedQty != null ? `План: ${selectedNode.plannedQty} ${selectedNode.unit ?? ""}` : ""}
                  </p>
                ) : null}
                <label>
                  Коэффициент (1 {materialUnit} склада → N в лимите)
                  <input
                    type="number"
                    min={MATERIAL_QTY_MIN}
                    step={MATERIAL_QTY_STEP}
                    value={quantity}
                    onChange={(e) => setQuantity(parseMaterialQty(e.target.value) || MATERIAL_QTY_MIN)}
                  />
                </label>
                {message ? <p className={message.includes("сохранена") ? "ok" : "error"}>{message}</p> : null}
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <button type="button" className="primaryBtn" disabled={saving || !limitNodeId} onClick={() => void saveBinding()}>
                    {saving ? "Сохранение…" : "Добавить привязку"}
                  </button>
                </div>
              </div>
            ) : null}

            {!limitNodes.length && !bindings.length ? (
              <p className="muted">Для этого объекта нет загруженного лимита в разделе {section === "SS" ? "СС" : "ЭОМ"}.</p>
            ) : null}
          </>
        ) : null}

        <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="ghostBtn" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
