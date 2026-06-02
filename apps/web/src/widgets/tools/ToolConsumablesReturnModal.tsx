import { useEffect, useState } from "react";
import { parseMaterialQty } from "../../shared/quantity";

type OpenLine = {
  id: string;
  name: string;
  unit: string;
  pending: number;
};

type ReturnDraft = {
  issueId: string;
  name: string;
  unit: string;
  pending: number;
  qtyNew: string;
  qtyUsed: string;
  writeoffQty: string;
  writeoffReason: string;
};

type Props = {
  open: boolean;
  toolId: string;
  toolName: string;
  warehouseId: string;
  section: "SS" | "EOM";
  token: string | null;
  apiUrl: string;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onDone: () => void;
};

export function ToolConsumablesReturnModal({
  open,
  toolId,
  toolName,
  warehouseId,
  section,
  token,
  apiUrl,
  fetchWithSession,
  onClose,
  onDone
}: Props) {
  const [drafts, setDrafts] = useState<ReturnDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    setLoading(true);
    setMessage("");
    void (async () => {
      try {
        const res = await fetchWithSession(`${apiUrl}/api/tools/${toolId}/open-consumables`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          setDrafts([]);
          return;
        }
        const data = (await res.json()) as { lines: OpenLine[]; hasOpen: boolean };
        setDrafts(
          data.lines
            .filter((l) => l.pending > 0)
            .map((l) => ({
              issueId: l.id,
              name: l.name,
              unit: l.unit,
              pending: l.pending,
              qtyNew: String(l.pending),
              qtyUsed: "0",
              writeoffQty: "0",
              writeoffReason: ""
            }))
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [open, token, toolId, apiUrl, fetchWithSession]);

  if (!open) return null;
  if (!loading && !drafts.length) return null;

  async function submit() {
    if (!token) return;
    const lines = drafts
      .map((d) => ({
        issueId: d.issueId,
        qtyNew: parseMaterialQty(d.qtyNew),
        qtyUsed: parseMaterialQty(d.qtyUsed),
        writeoffQty: parseMaterialQty(d.writeoffQty),
        writeoffReason: d.writeoffReason.trim() || undefined
      }))
      .filter((l) => l.qtyNew + l.qtyUsed + (l.writeoffQty ?? 0) > 0);
    if (!lines.length) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithSession(`${apiUrl}/api/tools/consumables/return`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ toolId, warehouseId, section, lines })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage(typeof (err as { error?: string }).error === "string" ? (err as { error: string }).error : "Ошибка возврата");
        return;
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
        <h3 style={{ marginTop: 0 }}>Возврат расходников: {toolName}</h3>
        <p className="muted">
          Укажите, сколько вернуть как новые, сколько — как использованные. Списание при поломке — отдельным полем с
          причиной.
        </p>
        {loading && <p className="muted">Загрузка...</p>}
        {message && <p className="resultBanner error">{message}</p>}
        {!loading && (
          <div className="erpTableWrap">
            <table className="erpTable desktopTable">
              <thead>
                <tr>
                  <th>Позиция</th>
                  <th style={{ width: 72 }}>Остаток</th>
                  <th style={{ width: 88 }}>Новые</th>
                  <th style={{ width: 100 }}>Использованные</th>
                  <th style={{ width: 88 }}>Списать</th>
                  <th>Причина списания</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, i) => (
                  <tr key={d.issueId}>
                    <td>
                      {d.name} <span className="muted">({d.unit})</span>
                    </td>
                    <td>{d.pending}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={d.pending}
                        value={d.qtyNew}
                        onChange={(e) =>
                          setDrafts((prev) => prev.map((row, j) => (j === i ? { ...row, qtyNew: e.target.value } : row)))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={d.qtyUsed}
                        onChange={(e) =>
                          setDrafts((prev) => prev.map((row, j) => (j === i ? { ...row, qtyUsed: e.target.value } : row)))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={d.writeoffQty}
                        onChange={(e) =>
                          setDrafts((prev) =>
                            prev.map((row, j) => (j === i ? { ...row, writeoffQty: e.target.value } : row))
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        placeholder="Поломка, износ…"
                        value={d.writeoffReason}
                        onChange={(e) =>
                          setDrafts((prev) =>
                            prev.map((row, j) => (j === i ? { ...row, writeoffReason: e.target.value } : row))
                          )
                        }
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
            Позже
          </button>
          <button type="button" className="primaryBtn" onClick={() => void submit()} disabled={submitting || loading}>
            Принять на склад
          </button>
        </div>
      </div>
    </div>
  );
}
