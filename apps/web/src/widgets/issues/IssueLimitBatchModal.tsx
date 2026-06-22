import { useEffect, useState } from "react";

export type IssueLimitBatchOption = {
  limitNodeId: string;
  path: string;
};

export type IssueLimitBatchRow = {
  materialId: string;
  materialLabel: string;
  pickKeys: string[];
  options: IssueLimitBatchOption[];
};

type Props = {
  rows: IssueLimitBatchRow[];
  onCancel: () => void;
  onConfirm: (selections: Record<string, string>) => void;
};

export function IssueLimitBatchModal({ rows, onCancel, onConfirm }: Props) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const row of rows) {
      if (row.options.length === 1) initial[row.materialId] = row.options[0]!.limitNodeId;
    }
    setSelections(initial);
  }, [rows]);

  const allChosen = rows.every((row) => Boolean(selections[row.materialId]?.trim()));

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modalCard issueLimitSubModal issueLimitBatchModal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Из каких лимитов выдаём</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Один и тот же материал приходил по разным строкам лимита. Укажите подраздел для каждой позиции в заказе на
          выдачу.
        </p>

        <div className="issueLimitBatchList">
          {rows.map((row) => (
            <label key={`batch-${row.materialId}`} className="issueLimitBatchRow">
              <span className="issueLimitBatchLabel">
                <strong>{row.materialLabel}</strong>
                {row.pickKeys.length > 1 ? (
                  <span className="muted"> · {row.pickKeys.length} строк в заказе</span>
                ) : null}
              </span>
              <select
                value={selections[row.materialId] || ""}
                onChange={(e) =>
                  setSelections((prev) => ({
                    ...prev,
                    [row.materialId]: e.target.value
                  }))
                }
              >
                <option value="">— выберите подраздел лимита —</option>
                {row.options.map((opt) => (
                  <option key={opt.limitNodeId} value={opt.limitNodeId}>
                    {opt.path}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" className="ghostBtn" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="primaryBtn"
            disabled={!allChosen}
            onClick={() => onConfirm(selections)}
          >
            Продолжить выдачу
          </button>
        </div>
      </div>
    </div>
  );
}
