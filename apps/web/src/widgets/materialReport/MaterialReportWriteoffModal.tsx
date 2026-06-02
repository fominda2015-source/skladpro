import { useEffect, useState } from "react";
import { formatMaterialQty, MATERIAL_QTY_MIN, MATERIAL_QTY_STEP, parseMaterialQty } from "../../shared/quantity";

export type WriteoffLine = {
  holderKey: string;
  materialId: string;
  name: string;
  unit: string;
  maxQty: number;
};

type Props = {
  lines: WriteoffLine[];
  token: string | null;
  apiUrl: string;
  warehouseId: string;
  section: "SS" | "EOM";
  fetchWithSession: typeof fetch;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
  safeName: (s: string) => string;
};

type RowState = WriteoffLine & { qty: string; selected: boolean };

export function MaterialReportWriteoffModal({
  lines,
  token,
  apiUrl,
  warehouseId,
  section,
  fetchWithSession,
  onClose,
  onDone,
  onError,
  safeName
}: Props) {
  const [rows, setRows] = useState<RowState[]>([]);
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(
      lines.map((ln) => ({
        ...ln,
        qty: String(ln.maxQty),
        selected: true
      }))
    );
    setComment("");
    setFile(null);
  }, [lines]);

  async function submit() {
    if (!token) return;
    const picked = rows.filter((r) => r.selected);
    if (!picked.length) {
      onError("Отметьте хотя бы одну позицию.");
      return;
    }
    for (const row of picked) {
      const qty = parseMaterialQty(row.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        onError(`Укажите количество для «${safeName(row.name)}».`);
        return;
      }
      if (qty > row.maxQty + 1e-6) {
        onError(`«${safeName(row.name)}»: не больше ${row.maxQty}.`);
        return;
      }
    }

    setBusy(true);
    try {
      for (const row of picked) {
        const qty = parseMaterialQty(row.qty);
        const form = new FormData();
        const payload: Record<string, unknown> = {
          warehouseId,
          section,
          holderKey: row.holderKey,
          materialId: row.materialId,
          quantity: qty
        };
        const c = comment.trim();
        if (c) payload.comment = c;
        form.append("payload", JSON.stringify(payload));
        if (file) form.append("file", file);
        const res = await fetchWithSession(`${apiUrl}/api/material-report/writeoffs`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string; balance?: number };
          const msg =
            typeof err.error === "string"
              ? err.error
              : res.status === 409 && typeof err.balance === "number"
                ? `Недостаточно остатка (доступно ${err.balance})`
                : `Списание не выполнено (${res.status})`;
          onError(`${safeName(row.name)}: ${msg}`);
          return;
        }
      }
      await onDone();
      onClose();
    } catch (e) {
      onError(`Ошибка сети: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="requestMaterialsModalBackdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="card requestMaterialsModalCard materialReportWriteoffModal"
        role="dialog"
        aria-labelledby="mr-writeoff-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="requestMaterialsModalHead">
          <h3 id="mr-writeoff-title">Списание с ответственного</h3>
          <button type="button" className="ghostBtn" disabled={busy} onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted">Отметьте позиции, укажите количество. Один документ прикрепится ко всем строкам.</p>
        <div className="erpTableWrap">
          <table className="erpTable desktopTable">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Материал</th>
                <th style={{ width: 120 }}>Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.holderKey}-${row.materialId}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((x) =>
                            x.materialId === row.materialId && x.holderKey === row.holderKey
                              ? { ...x, selected: e.target.checked }
                              : x
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    {safeName(row.name)} <span className="muted">({row.unit})</span>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={MATERIAL_QTY_MIN}
                      step={MATERIAL_QTY_STEP}
                      max={row.maxQty}
                      value={row.qty}
                      disabled={!row.selected}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((x) =>
                            x.materialId === row.materialId && x.holderKey === row.holderKey
                              ? { ...x, qty: e.target.value.replace(/[^\d]/g, "") }
                              : x
                          )
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="materialReportField">
          Комментарий
          <input value={comment} onChange={(e) => setComment(e.target.value)} disabled={busy} />
        </label>
        <label className="materialReportField">
          Документ (акт, скан)
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="ghostBtn" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="primaryBtn" disabled={busy} onClick={() => void submit()}>
            {busy ? "Списание…" : "Списать выбранное"}
          </button>
        </div>
      </div>
    </div>
  );
}
