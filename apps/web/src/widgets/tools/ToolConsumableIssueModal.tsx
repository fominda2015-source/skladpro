import { createPortal } from "react-dom";
import { useState } from "react";
import { parseMaterialQty, sanitizeMaterialQtyInput } from "../../shared/quantity";
import { consumableConditionLabel, type ToolCatalogConsumableLine } from "./toolCatalog";

type Props = {
  open: boolean;
  line: ToolCatalogConsumableLine;
  recipientSuggestions: string[];
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (data: { recipient: string; quantity: number; comment: string }) => Promise<boolean>;
};

export function ToolConsumableIssueModal({
  open,
  line,
  recipientSuggestions,
  submitting = false,
  onClose,
  onSubmit
}: Props) {
  const [recipient, setRecipient] = useState("");
  const [comment, setComment] = useState("");
  const [qty, setQty] = useState("");
  const [message, setMessage] = useState("");

  if (!open) return null;

  const maxQty = line.quantity;
  const suggestQty = String(maxQty);

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
          <div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Выдача расходника
            </p>
            <h3 style={{ margin: "4px 0 0" }}>Кому выдать</h3>
          </div>
          <button type="button" className="ghostBtn" disabled={submitting} onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p className="muted">
          {line.name} · {consumableConditionLabel(line.condition)} · доступно{" "}
          <strong>{maxQty}</strong> {line.unit}
        </p>
        {line.condition === "USED" ? (
          <p className="resultBanner warn" style={{ fontSize: 13 }}>
            Выдаёте б/у позицию — сначала расходуем старые остатки.
          </p>
        ) : null}
        <div className="form">
          <label>
            Получатель (обязательно)
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              list="tool-consumable-issue-recipients"
              autoFocus
            />
            <datalist id="tool-consumable-issue-recipients">
              {recipientSuggestions.map((name) => (
                <option key={`tci-${name}`} value={name} />
              ))}
            </datalist>
          </label>
          <label>
            Количество ({line.unit})
            <input
              type="text"
              inputMode="numeric"
              value={qty || suggestQty}
              onChange={(e) => setQty(sanitizeMaterialQtyInput(e.target.value))}
              placeholder={suggestQty}
            />
          </label>
          <label>
            Комментарий
            <input value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
        </div>
        {message ? <p className="resultBanner error">{message}</p> : null}
        <div className="toolbar" style={{ marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="ghostBtn" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button
            type="button"
            className="primaryBtn"
            disabled={submitting || !recipient.trim()}
            onClick={() => {
              const quantity = parseMaterialQty(qty || suggestQty);
              if (!Number.isFinite(quantity) || quantity <= 0) {
                setMessage("Укажите количество");
                return;
              }
              if (quantity > maxQty) {
                setMessage(`Максимум ${maxQty} ${line.unit}`);
                return;
              }
              setMessage("");
              void onSubmit({ recipient: recipient.trim(), quantity, comment: comment.trim() }).then((ok) => {
                if (!ok) setMessage("Не удалось выдать");
              });
            }}
          >
            {submitting ? "Выдача…" : "Выдать"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
