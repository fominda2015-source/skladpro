import { useEffect, useState } from "react";
import { MATERIAL_QTY_MIN, MATERIAL_QTY_STEP, parseMaterialQty } from "../../shared/quantity";
import type { ToolCatalogMaterialRow } from "./toolCatalog";

type PickLine = { materialId: string; name: string; unit: string; maxQty: number; qty: string };

type Props = {
  open: boolean;
  toolIds: string[];
  toolLabel: string;
  warehouseId: string;
  section: "SS" | "EOM";
  holderName: string;
  issueRequestId?: string;
  token: string | null;
  apiUrl: string;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onDone: () => void;
};

export function ToolConsumablesIssueModal({
  open,
  toolIds,
  toolLabel,
  warehouseId,
  section,
  holderName,
  issueRequestId,
  token,
  apiUrl,
  fetchWithSession,
  onClose,
  onDone
}: Props) {
  const [lines, setLines] = useState<PickLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !token || !warehouseId) return;
    setLoading(true);
    setMessage("");
    void (async () => {
      try {
        const q = new URLSearchParams({
          section: "TOOL_CONSUMABLE",
          warehouseId,
          sectionFilter: section
        });
        const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/materials?${q}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          setMessage("Не удалось загрузить расходники");
          setLines([]);
          return;
        }
        const rows = (await res.json()) as ToolCatalogMaterialRow[];
        setLines(
          rows.slice(0, 40).map((r) => ({
            materialId: r.materialId,
            name: r.name,
            unit: r.unit,
            maxQty: r.qtyNew,
            qty: ""
          }))
        );
      } catch {
        setMessage("Ошибка загрузки");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, token, warehouseId, section, apiUrl, fetchWithSession]);

  if (!open) return null;

  async function submit() {
    if (!token || !toolIds.length) return;
    const items = lines
      .map((l) => ({ materialId: l.materialId, quantity: parseMaterialQty(l.qty) }))
      .filter((x) => x.quantity > 0);
    if (!items.length) {
      onClose();
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      for (const toolId of toolIds) {
        const res = await fetchWithSession(`${apiUrl}/api/tools/consumables/issue`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            toolId,
            warehouseId,
            section,
            holderName,
            issueRequestId,
            items
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setMessage(typeof (err as { error?: string }).error === "string" ? (err as { error: string }).error : "Ошибка выдачи расходников");
          return;
        }
      }
      onDone();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modalOverlayCenter"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card modalCardWide" onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Выдать расходники для инструмента</h3>
        <p className="muted">
          К выданному инструменту: <strong>{toolLabel}</strong>. Отметьте количество по позициям (можно пропустить).
        </p>
        {loading && <p className="muted">Загрузка номенклатуры...</p>}
        {message && <p className="resultBanner error">{message}</p>}
        {!loading && lines.length > 0 && (
          <div className="erpTableWrap">
            <table className="erpTable desktopTable">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th style={{ width: 72 }}>На складе</th>
                  <th style={{ width: 100 }}>Выдать</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.materialId}>
                    <td>
                      {l.name} <span className="muted">({l.unit})</span>
                    </td>
                    <td>{l.maxQty}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={l.maxQty}
                        step={MATERIAL_QTY_STEP}
                        value={l.qty}
                        onChange={(e) => {
                          const qty = e.target.value.replace(/[^\d]/g, "");
                          setLines((prev) => prev.map((row, j) => (j === i ? { ...row, qty } : row)));
                        }}
                        style={{ width: "100%" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="toolbar" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="ghostBtn" onClick={onClose} disabled={submitting}>
            Пропустить
          </button>
          <button type="button" className="primaryBtn" onClick={() => void submit()} disabled={submitting || loading}>
            Выдать расходники
          </button>
        </div>
      </div>
    </div>
  );
}
