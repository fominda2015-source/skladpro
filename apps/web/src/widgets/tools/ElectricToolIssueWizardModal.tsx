import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { parseMaterialQty } from "../../shared/quantity";
import { ToolCatalogMaterialCards } from "./ToolCatalogMaterialCards";
import type { ToolCatalogMaterialRow } from "./toolCatalog";
import type { ConsumablePickLine, ElectricToolIssueWizardSubmit } from "./electricToolIssue";

type WizardStep = "consumables" | "recipient";

type Props = {
  open: boolean;
  toolIds: string[];
  toolLabel: string;
  warehouseId: string;
  section: "SS" | "EOM";
  token: string | null;
  apiUrl: string;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  recipientSuggestions: string[];
  initialRecipient?: string;
  initialComment?: string;
  onClose: () => void;
  onSubmit: (data: ElectricToolIssueWizardSubmit) => Promise<boolean>;
};

export function ElectricToolIssueWizardModal({
  open,
  toolLabel,
  warehouseId,
  section,
  token,
  apiUrl,
  fetchWithSession,
  recipientSuggestions,
  initialRecipient = "",
  initialComment = "",
  onClose,
  onSubmit
}: Props) {
  const [step, setStep] = useState<WizardStep>("consumables");
  const [lines, setLines] = useState<ConsumablePickLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recipient, setRecipient] = useState(initialRecipient);
  const [comment, setComment] = useState(initialComment);
  const [photo, setPhoto] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("consumables");
    setRecipient(initialRecipient);
    setComment(initialComment);
    setPhoto(null);
    setMessage("");
  }, [open, initialRecipient, initialComment]);

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
          rows
            .filter((r) => r.qtyNew > 0)
            .slice(0, 80)
            .map((r) => ({
              materialId: r.materialId,
              name: r.name,
              unit: r.unit,
              maxQty: r.qtyNew,
              qtyNew: r.qtyNew,
              qtyUsed: r.qtyUsed,
              qty: ""
            }))
        );
      } catch {
        setMessage("Ошибка загрузки расходников");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, token, warehouseId, section, apiUrl, fetchWithSession]);

  const pickedConsumables = useMemo(
    () =>
      lines
        .map((l) => ({ materialId: l.materialId, quantity: parseMaterialQty(l.qty) }))
        .filter((x) => x.quantity > 0),
    [lines]
  );

  async function finish() {
    const holder = recipient.trim();
    if (!holder) {
      setMessage("Укажите получателя");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const ok = await onSubmit({
        recipient: holder,
        comment: comment.trim(),
        photo,
        consumables: pickedConsumables
      });
      if (ok) onClose();
    } catch {
      setMessage("Не удалось завершить выдачу");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="modalOverlayCenter"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="card modalCardWide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Шаг {step === "consumables" ? "1" : "2"} из 2
            </p>
            <h3 style={{ margin: "4px 0 0" }}>
              {step === "consumables" ? "Выдать расходники для инструмента?" : "Кому выдать"}
            </h3>
          </div>
          <button type="button" className="ghostBtn" disabled={submitting} onClick={onClose}>
            Закрыть
          </button>
        </div>

        {step === "consumables" ? (
          <>
            <p className="muted">
              Электрический инструмент: <strong>{toolLabel}</strong>. Выберите карточки и укажите количество — после
              первой выдачи и возврата «б/у» остаток делится на новые и использованные.
            </p>
            {loading && <p className="muted">Загрузка номенклатуры...</p>}
            {!loading && !lines.length && (
              <p className="muted">На объекте нет расходников для инструмента в наличии — можно перейти к выдаче.</p>
            )}
            {!loading && lines.length > 0 && (
              <div className="toolCatalogMaterialPickScroll">
                <ToolCatalogMaterialCards
                  mode="pick"
                  loading={loading}
                  rows={lines.map((l, i) => ({
                    materialId: l.materialId,
                    name: l.name,
                    unit: l.unit,
                    warehouseId,
                    warehouseName: "",
                    section,
                    qtyNew: l.qtyNew,
                    qtyUsed: l.qtyUsed,
                    maxQty: l.maxQty,
                    qty: l.qty,
                    onQtyChange: (qty) => {
                      setLines((prev) => prev.map((row, j) => (j === i ? { ...row, qty } : row)));
                    }
                  }))}
                />
              </div>
            )}
            {message && step === "consumables" ? <p className="resultBanner error">{message}</p> : null}
            <div className="toolbar" style={{ marginTop: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
              <button type="button" className="ghostBtn" onClick={onClose} disabled={submitting}>
                Отмена
              </button>
              <button
                type="button"
                className="primaryBtn"
                disabled={submitting || loading}
                onClick={() => {
                  setMessage("");
                  setStep("recipient");
                }}
              >
                Далее →
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Инструмент: <strong>{toolLabel}</strong>
              {pickedConsumables.length ? (
                <> · расходников: {pickedConsumables.length} поз.</>
              ) : (
                " · без расходников"
              )}
            </p>
            <div className="form">
              <label>
                Получатель (обязательно)
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  list="electric-tool-issue-recipients"
                  autoFocus
                />
                <datalist id="electric-tool-issue-recipients">
                  {recipientSuggestions.map((name) => (
                    <option key={`etr-${name}`} value={name} />
                  ))}
                </datalist>
              </label>
              <label>
                Комментарий
                <input value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <label>
                Фотофиксация (опционально)
                <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
              </label>
            </div>
            {message ? <p className="resultBanner error">{message}</p> : null}
            <div className="toolbar" style={{ marginTop: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
              <button
                type="button"
                className="ghostBtn"
                disabled={submitting}
                onClick={() => {
                  setMessage("");
                  setStep("consumables");
                }}
              >
                ← Назад
              </button>
              <button
                type="button"
                className="primaryBtn"
                disabled={submitting || !recipient.trim()}
                onClick={() => void finish()}
              >
                {submitting ? "Выдача…" : "Выдать"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
