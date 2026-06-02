import { useEffect, useMemo, useState } from "react";
import { MATERIAL_QTY_MIN, MATERIAL_QTY_STEP, parseMaterialQty } from "../../shared/quantity";

type IssueItem = {
  id: string;
  materialId: string;
  quantity: string | number;
  factLabel?: string | null;
  limitNodeId?: string | null;
  material?: { name: string; sku?: string | null; unit?: string };
};

type IssueRow = {
  id: string;
  number: string;
  status: string;
  domain?: string;
  responsibleName?: string | null;
  actualRecipientName?: string | null;
  items?: IssueItem[];
  toolItems?: Array<{ id: string; toolId: string; tool?: { name: string; inventoryNumber: string } }>;
};

type MaterialOption = {
  id: string;
  name: string;
  unit: string;
  sku?: string | null;
};

type EditLine = {
  key: string;
  id?: string;
  materialId: string;
  quantity: string;
  factLabel: string;
  limitNodeId?: string | null;
  label: string;
  unit: string;
};

type Props = {
  issue: IssueRow;
  materials: MaterialOption[];
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
};

function lineKey(line: EditLine) {
  return line.key;
}

export function AdminIssueEditModal({
  issue,
  materials,
  token,
  apiUrl,
  fetchWithSession,
  onClose,
  onSaved,
  onError
}: Props) {
  const isTools = issue.domain === "TOOLS" || Boolean(issue.toolItems?.length);
  const [responsibleName, setResponsibleName] = useState(issue.responsibleName || "");
  const [actualRecipientName, setActualRecipientName] = useState(issue.actualRecipientName || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [newMaterialId, setNewMaterialId] = useState("");
  const [newQty, setNewQty] = useState("1");

  useEffect(() => {
    const initial =
      issue.items?.map((row) => ({
        key: row.id,
        id: row.id,
        materialId: row.materialId,
        quantity: String(row.quantity),
        factLabel: row.factLabel?.trim() || "",
        limitNodeId: row.limitNodeId ?? null,
        label: row.factLabel?.trim() || row.material?.name || row.materialId,
        unit: row.material?.unit || "шт"
      })) ?? [];
    setLines(initial);
    setResponsibleName(issue.responsibleName || "");
    setActualRecipientName(issue.actualRecipientName || "");
    setReason("");
  }, [issue]);

  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  async function submit() {
    if (!token) return;
    const reasonTrim = reason.trim();
    if (reasonTrim.length < 3) {
      onError("Укажите причину правки (не менее 3 символов).");
      return;
    }
    if (!isTools) {
      const parsedLines = lines
        .map((ln) => {
          const qty = parseMaterialQty(ln.quantity);
          if (!ln.materialId || !Number.isFinite(qty) || qty <= 0) return null;
          return {
            id: ln.id,
            materialId: ln.materialId,
            quantity: qty,
            factLabel: ln.factLabel.trim() || null,
            limitNodeId: ln.limitNodeId ?? null
          };
        })
        .filter(Boolean) as Array<{
        id?: string;
        materialId: string;
        quantity: number;
        factLabel: string | null;
        limitNodeId: string | null;
      }>;
      if (!parsedLines.length) {
        onError("Добавьте хотя бы одну строку материала.");
        return;
      }
      setBusy(true);
      try {
        const res = await fetchWithSession(`${apiUrl}/api/issues/${encodeURIComponent(issue.id)}/admin-edit`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: reasonTrim,
            responsibleName: responsibleName.trim() || null,
            actualRecipientName: actualRecipientName.trim() || null,
            items: parsedLines
          })
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          onError(typeof body.error === "string" ? body.error : `Не удалось сохранить (HTTP ${res.status})`);
          return;
        }
        await onSaved();
        onClose();
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const res = await fetchWithSession(`${apiUrl}/api/issues/${encodeURIComponent(issue.id)}/admin-edit`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reasonTrim,
          responsibleName: responsibleName.trim() || null,
          actualRecipientName: actualRecipientName.trim() || null
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        onError(typeof body.error === "string" ? body.error : `Не удалось сохранить (HTTP ${res.status})`);
        return;
      }
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="requestMaterialsModalBackdrop" role="presentation" onClick={onClose}>
      <div
        className="card requestMaterialsModalCard adminIssueEditModal"
        role="dialog"
        aria-labelledby="adminIssueEditTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="requestMaterialsModalHead">
          <h3 id="adminIssueEditTitle">Правка выдачи · {issue.number}</h3>
          <button type="button" className="ghostBtn" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="muted adminIssueEditHint">
          Только для администратора. При проведённой выдаче остатки и лимиты пересчитываются автоматически.
        </p>

        <label className="adminIssueEditField">
          Ответственный
          <input value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)} maxLength={160} />
        </label>
        <label className="adminIssueEditField">
          Фактически получил
          <input
            value={actualRecipientName}
            onChange={(e) => setActualRecipientName(e.target.value)}
            maxLength={160}
          />
        </label>

        {isTools ? (
          <div className="card" style={{ marginTop: 10 }}>
            <h4>Инструменты</h4>
            <ul className="plainList">
              {(issue.toolItems || []).map((line) => (
                <li key={line.id}>
                  {line.tool?.inventoryNumber || line.toolId.slice(0, 8)} · {line.tool?.name || line.toolId}
                </li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: 12 }}>
              Состав инструментов не меняется — можно исправить получателя.
            </p>
          </div>
        ) : (
          <div className="adminIssueEditLines">
            <h4>Позиции</h4>
            <div className="erpTableWrap">
              <table className="erpTable desktopTable">
                <thead>
                  <tr>
                    <th>Материал</th>
                    <th style={{ width: 110 }}>Кол-во</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln) => (
                    <tr key={lineKey(ln)}>
                      <td>{ln.label}</td>
                      <td>
                        <input
                          type="number"
                          min={MATERIAL_QTY_MIN}
                          step={MATERIAL_QTY_STEP}
                          value={ln.quantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x) => (x.key === ln.key ? { ...x, quantity: e.target.value.replace(/[^\d]/g, "") } : x))
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ghostBtn"
                          title="Удалить строку"
                          onClick={() => setLines((prev) => prev.filter((x) => x.key !== ln.key))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="toolbar" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <select value={newMaterialId} onChange={(e) => setNewMaterialId(e.target.value)} aria-label="Материал">
                <option value="">Добавить материал…</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0.001}
                step="any"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                style={{ width: 90 }}
                aria-label="Количество"
              />
              <button
                type="button"
                className="secondaryBtn"
                disabled={!newMaterialId}
                onClick={() => {
                  const mat = materialById.get(newMaterialId);
                  if (!mat) return;
                  const qty = parseMaterialQty(newQty);
                  if (qty <= 0) return;
                  setLines((prev) => [
                    ...prev,
                    {
                      key: `new-${Date.now()}-${newMaterialId}`,
                      materialId: mat.id,
                      quantity: String(qty),
                      factLabel: "",
                      label: mat.name,
                      unit: mat.unit
                    }
                  ]);
                  setNewMaterialId("");
                  setNewQty("1");
                }}
              >
                + Строка
              </button>
            </div>
          </div>
        )}

        <label className="adminIssueEditField">
          Причина правки
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} />
        </label>

        <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="ghostBtn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="primaryBtn" onClick={() => void submit()} disabled={busy}>
            {busy ? "Сохранение…" : "Сохранить правку"}
          </button>
        </div>
      </div>
    </div>
  );
}
