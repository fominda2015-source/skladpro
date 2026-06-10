import { createPortal } from "react-dom";
import { useState } from "react";
import { parseMaterialQty, sanitizeMaterialQtyInput } from "../../shared/quantity";
import { consumableConditionLabel, type ToolCatalogConsumableLine } from "./toolCatalog";

export type ConsumableCardAction = "WRITE_OFF" | "DISPUTE";

type Props = {
  open: boolean;
  action: ConsumableCardAction;
  line: ToolCatalogConsumableLine;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (data: { comment: string; quantity?: number }) => Promise<boolean>;
};

export function ToolConsumableActionModal({ open, action, line, submitting = false, onClose, onSubmit }: Props) {
  const [comment, setComment] = useState("");
  const [qty, setQty] = useState(String(line.quantity));
  const [message, setMessage] = useState("");

  if (!open) return null;

  const title = action === "WRITE_OFF" ? "Списать расходник" : "Пометить спорным";

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
        <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="ghostBtn" disabled={submitting} onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p className="muted">
          {line.name} · {consumableConditionLabel(line.condition)} · на складе {line.quantity} {line.unit}
        </p>
        <div className="form">
          {action === "WRITE_OFF" ? (
            <label>
              Количество к списанию ({line.unit})
              <input
                type="text"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(sanitizeMaterialQtyInput(e.target.value))}
              />
            </label>
          ) : null}
          <label>
            Комментарий
            <input value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
          </label>
        </div>
        {message ? <p className="resultBanner error">{message}</p> : null}
        <div className="toolbar" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="ghostBtn" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button
            type="button"
            className="primaryBtn"
            disabled={submitting}
            onClick={() => {
              if (action === "WRITE_OFF") {
                const quantity = parseMaterialQty(qty);
                if (!Number.isFinite(quantity) || quantity <= 0 || quantity > line.quantity) {
                  setMessage(`Укажите количество от 1 до ${line.quantity}`);
                  return;
                }
                void onSubmit({ comment: comment.trim(), quantity }).then((ok) => {
                  if (!ok) setMessage("Не удалось выполнить действие");
                });
              } else {
                void onSubmit({ comment: comment.trim() }).then((ok) => {
                  if (!ok) setMessage("Не удалось выполнить действие");
                });
              }
            }}
          >
            {submitting ? "…" : action === "WRITE_OFF" ? "Списать" : "Пометить спорным"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
