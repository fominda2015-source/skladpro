import { useEffect, useState } from "react";
import { API_URL } from "../../app/constants";
import { LoadingState } from "../../shared/ui/StateViews";

export type LimitNodePickRow = {
  id: string;
  path: string;
  templateTitle?: string;
  plannedQty?: number | null;
};

type Props = {
  token: string | null;
  fetchWithSession: typeof fetch;
  warehouseId: string;
  section: "SS" | "EOM";
  materialId: string;
  sourceName: string;
  materialLabel: string;
  initialLimitNodeId?: string | null;
  onCancel: () => void;
  onConfirm: (limitNodeId: string, path: string) => void;
};

export function IssueLimitSubsectionModal({
  token,
  fetchWithSession,
  warehouseId,
  section,
  materialId,
  sourceName,
  materialLabel,
  initialLimitNodeId,
  onCancel,
  onConfirm
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picks, setPicks] = useState<LimitNodePickRow[]>([]);
  const [limitNodeId, setLimitNodeId] = useState(initialLimitNodeId || "");

  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams({
      warehouseId,
      section,
      materialId,
      sourceName
    });
    setLoading(true);
    setError("");
    void fetchWithSession(`${API_URL}/api/limit-imports/material-nodes?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as LimitNodePickRow[];
        setPicks(rows);
        if (!limitNodeId && rows.length === 1) setLimitNodeId(rows[0].id);
        else if (!limitNodeId && rows.length > 1) setLimitNodeId(rows[1]?.id || rows[0].id);
      })
      .catch((e) => {
        setError(String(e));
        setPicks([]);
      })
      .finally(() => setLoading(false));
  }, [token, fetchWithSession, warehouseId, section, materialId, sourceName]);

  const selected = picks.find((p) => p.id === limitNodeId);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modalCard issueLimitSubModal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Выдать из другого подраздела</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Материал «<strong>{materialLabel}</strong>» может быть в нескольких подразделах лимита. Приход остаётся в том
          подразделе, куда приняли заявку; выдача и списание по лимиту — в выбранном ниже.
        </p>

        {loading ? <LoadingState text="Поиск в лимитах…" /> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && !error && picks.length === 0 ? (
          <p className="muted">В лимитах раздела {section === "SS" ? "СС" : "ЭОМ"} этот материал не найден.</p>
        ) : null}
        {!loading && picks.length > 0 ? (
          <label style={{ display: "block", marginBottom: 12 }}>
            Подраздел для выдачи
            <select
              value={limitNodeId}
              onChange={(e) => setLimitNodeId(e.target.value)}
              style={{ width: "100%", marginTop: 6 }}
            >
              {picks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.path}
                  {p.plannedQty != null ? ` · план ${p.plannedQty}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {selected ? (
          <p className="issueLimitSubHint" role="status">
            Выдача будет отнесена к: <strong>{selected.path}</strong>
          </p>
        ) : null}

        <div className="toolbar" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" className="ghostBtn" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="primaryBtn"
            disabled={!limitNodeId || !picks.length}
            onClick={() => {
              const pick = picks.find((p) => p.id === limitNodeId);
              if (pick) onConfirm(pick.id, pick.path);
            }}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
