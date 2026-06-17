import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatMaterialQty, parseMaterialQty } from "../../shared/quantity";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type Props = {
  open: boolean;
  issueId: string;
  issueNumber: string;
  item: {
    id: string;
    name: string;
    unit: string;
    quantity: number;
    returnedQty: number;
  };
  token: string;
  apiUrl: string;
  fetchWithSession: FetchFn;
  onClose: () => void;
  onDone: () => void;
};

export function IssueItemReturnModal({
  open,
  issueId,
  issueNumber,
  item,
  token,
  apiUrl,
  fetchWithSession,
  onClose,
  onDone
}: Props) {
  const pending = Math.max(0, item.quantity - item.returnedQty);
  const [qty, setQty] = useState(String(pending || ""));
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQty(String(pending || ""));
    setMessage("");
    setSubmitting(false);
  }, [open, pending, item.id]);

  if (!open) return null;

  async function submit() {
    const returnQty = parseMaterialQty(qty);
    if (returnQty <= 0) {
      setMessage("Укажите количество больше нуля");
      return;
    }
    if (returnQty > pending + 1e-9) {
      setMessage(`Можно вернуть не больше ${formatMaterialQty(pending)} ${item.unit}`);
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const res = await fetchWithSession(
        `${apiUrl}/api/issues/${encodeURIComponent(issueId)}/items/${encodeURIComponent(item.id)}/return`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: returnQty })
        }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; pending?: number };
        if (err.error === "RETURN_EXCEEDS_PENDING" && typeof err.pending === "number") {
          setMessage(`Можно вернуть не больше ${formatMaterialQty(err.pending)} ${item.unit}`);
        } else {
          setMessage(typeof err.error === "string" ? err.error : "Не удалось оформить возврат");
        }
        return;
      }
      onDone();
      onClose();
    } catch {
      setMessage("Ошибка сети");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="requestMaterialsModalBackdrop" role="presentation" onClick={() => !submitting && onClose()}>
      <div
        className="card issueReturnModal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>Возврат на склад</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Заявка {issueNumber} · {item.name}
        </p>
        <dl className="issueReturnStats">
          <div>
            <dt>Выдано</dt>
            <dd>
              {formatMaterialQty(item.quantity)} {item.unit}
            </dd>
          </div>
          <div>
            <dt>Уже возвращено</dt>
            <dd>
              {formatMaterialQty(item.returnedQty)} {item.unit}
            </dd>
          </div>
          <div>
            <dt>Можно вернуть</dt>
            <dd>
              {formatMaterialQty(pending)} {item.unit}
            </dd>
          </div>
        </dl>
        <label className="issueReturnQtyField">
          Вернуть, {item.unit}
          <input
            type="text"
            inputMode="decimal"
            value={qty}
            disabled={submitting || pending <= 0}
            onChange={(e) => setQty(e.target.value)}
            autoFocus
          />
        </label>
        {message ? <p className="error">{message}</p> : null}
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button type="button" className="ghostBtn" disabled={submitting} onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="primaryBtn" disabled={submitting || pending <= 0} onClick={() => void submit()}>
            {submitting ? "Возврат…" : "Вернуть на склад"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
