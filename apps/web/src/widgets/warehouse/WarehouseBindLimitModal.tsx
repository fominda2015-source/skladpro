import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../../app/constants";
import { HomeDrillModal } from "../home/HomeDrillModal";
import { LimitTreeExplorer, type LimitPickNode, type LimitSection } from "../limits/LimitTreeExplorer";
import { MATERIAL_QTY_MIN, MATERIAL_QTY_STEP, parseMaterialQty } from "../../shared/quantity";

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
  section: LimitSection;
  materialId: string;
  materialName: string;
  materialUnit: string;
  canWrite: boolean;
  safeName: (n: string) => string;
  onClose: () => void;
};

export function WarehouseBindLimitModal({
  token,
  fetchWithSession,
  warehouseId,
  section: initialSection,
  materialId,
  materialName,
  materialUnit,
  canWrite,
  safeName,
  onClose
}: Props) {
  const [section, setSection] = useState<LimitSection>(initialSection);
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(true);
  const [picked, setPicked] = useState<LimitPickNode | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const loadBindings = useCallback(async () => {
    if (!token) return;
    setBindingsLoading(true);
    try {
      const params = new URLSearchParams({ warehouseId, section, materialId });
      const res = await fetchWithSession(`${API_URL}/api/material-limit-bindings?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setBindings((await res.json()) as BindingRow[]);
      } else {
        setBindings([]);
      }
    } finally {
      setBindingsLoading(false);
    }
  }, [token, fetchWithSession, warehouseId, section, materialId]);

  useEffect(() => {
    void loadBindings();
  }, [loadBindings]);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    setPicked(null);
    setQuantity(1);
    setMessage("");
  }, [section, materialId]);

  const boundNodeIds = useMemo(() => new Set(bindings.map((b) => b.limitNodeId)), [bindings]);

  async function saveBinding() {
    if (!token || !canWrite || saving || !picked) return;
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
          limitNodeId: picked.id,
          quantity: qty
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(typeof body.error === "string" ? body.error : "Не удалось сохранить");
        return;
      }
      setMessage("Привязка сохранена");
      setPicked(null);
      setQuantity(1);
      await loadBindings();
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
    if (res.ok) await loadBindings();
  }

  return (
    <HomeDrillModal
      title="Привязать к лимиту"
      subtitle={`${materialName} (${materialUnit}) · клик по строке материала в дереве лимита`}
      size="wide"
      onClose={onClose}
      drillSection={section}
      onDrillSectionChange={setSection}
    >
      <div className="warehouseBindLimitLayout">
        <aside className="warehouseBindLimitAside card">
          <h4 style={{ margin: "0 0 8px" }}>Материал склада</h4>
          <p style={{ margin: "0 0 12px" }}>
            <strong>{materialName}</strong>
            <span className="muted"> · {materialUnit}</span>
          </p>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
            Приход, выдача и остаток учитываются в выбранной строке лимита. Коэффициент: 1 ед. склада → N ед. в
            лимите.
          </p>

          <h4 style={{ margin: "0 0 8px" }}>Текущие привязки</h4>
          {bindingsLoading ? <p className="muted">Загрузка…</p> : null}
          {!bindingsLoading && bindings.length === 0 ? <p className="muted">Пока нет привязок.</p> : null}
          {!bindingsLoading && bindings.length > 0 ? (
            <ul className="warehouseBindLimitItems">
              {bindings.map((b) => (
                <li key={b.id}>
                  <div>
                    <strong>{b.limitMaterialName || "Строка лимита"}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      коэфф. {b.quantity}
                    </div>
                  </div>
                  {canWrite ? (
                    <button type="button" className="ghostBtn" onClick={() => void removeBinding(b.id)}>
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {picked && canWrite ? (
            <div className="warehouseBindLimitPickForm">
              <h4 style={{ margin: "12px 0 8px" }}>Новая привязка</h4>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                {picked.materialName || picked.title}
                {picked.plannedQty != null ? ` · план ${picked.plannedQty} ${picked.unit ?? ""}` : ""}
              </p>
              <label>
                Коэффициент (1 {materialUnit} → N в лимите)
                <input
                  type="number"
                  min={MATERIAL_QTY_MIN}
                  step={MATERIAL_QTY_STEP}
                  value={quantity}
                  onChange={(e) => setQuantity(parseMaterialQty(e.target.value) || MATERIAL_QTY_MIN)}
                />
              </label>
              {message ? (
                <p className={message.includes("сохранена") ? "ok" : "error"} style={{ marginTop: 8 }}>
                  {message}
                </p>
              ) : null}
              <button
                type="button"
                className="primaryBtn"
                style={{ marginTop: 8, width: "100%" }}
                disabled={saving}
                onClick={() => void saveBinding()}
              >
                {saving ? "Сохранение…" : "Сохранить привязку"}
              </button>
            </div>
          ) : null}
        </aside>

        <div className="warehouseBindLimitTree">
          <LimitTreeExplorer
            warehouseId={warehouseId}
            section={section}
            token={token}
            fetchWithSession={fetchWithSession}
            safeName={safeName}
            pickMode
            selectedNodeId={picked?.id ?? null}
            onPickNode={setPicked}
            boundNodeIds={boundNodeIds}
          />
        </div>
      </div>
    </HomeDrillModal>
  );
}
