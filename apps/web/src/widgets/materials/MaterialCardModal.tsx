import { useEffect, useState } from "react";

type MaterialDetail = {
  id: string;
  name: string;
  sku?: string | null;
  unit: string;
  kind?: "MATERIAL" | "CONSUMABLE" | "WORKWEAR";
  unitPrice?: number | null;
  category?: string | null;
  synonyms?: Array<{ id: string; value: string }>;
};

type EmployeeOption = { id: string; fullName: string; email?: string; role?: string };

type Props = {
  materialId: string;
  defaultWarehouseId: string;
  section: "SS" | "EOM";
  apiUrl: string;
  token: string;
  fetchWithSession: typeof fetch;
  canWrite: boolean;
  canGrantAccess: boolean;
  employees: EmployeeOption[];
  warehouses: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
};

export function MaterialCardModal(props: Props) {
  const {
    materialId,
    defaultWarehouseId,
    section,
    apiUrl,
    token,
    fetchWithSession,
    canWrite,
    canGrantAccess,
    employees,
    warehouses,
    onClose,
    onSaved
  } = props;

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("шт");
  const [kind, setKind] = useState<"MATERIAL" | "CONSUMABLE" | "WORKWEAR">("MATERIAL");
  const [unitPrice, setUnitPrice] = useState("");
  const [category, setCategory] = useState("");
  const [newSynonym, setNewSynonym] = useState("");
  const [synonyms, setSynonyms] = useState<Array<{ id: string; value: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantWarehouseId, setGrantWarehouseId] = useState(defaultWarehouseId);
  const [grantBusy, setGrantBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetchWithSession(`${apiUrl}/api/materials/${materialId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          if (!cancelled) setMessage("Не удалось загрузить карточку материала");
          return;
        }
        const m = (await res.json()) as MaterialDetail;
        if (cancelled) return;
        setName(m.name);
        setSku(m.sku || "");
        setUnit(m.unit || "шт");
        setKind(m.kind || "MATERIAL");
        setUnitPrice(m.unitPrice != null ? String(m.unitPrice) : "");
        setCategory(m.category || "");
        setSynonyms(m.synonyms || []);
      } catch {
        if (!cancelled) setMessage("Ошибка загрузки");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, fetchWithSession, materialId, token]);

  async function saveMaterial() {
    if (!canWrite) return;
    setSaving(true);
    setMessage("");
    try {
      const priceRaw = unitPrice.trim().replace(",", ".");
      const body: Record<string, unknown> = {
        name: name.trim(),
        sku: sku.trim() || null,
        unit: unit.trim() || "шт",
        kind,
        category: category.trim() || null
      };
      if (priceRaw) {
        const p = Number(priceRaw);
        if (!Number.isFinite(p) || p < 0) {
          setMessage("Цена должна быть числом ≥ 0");
          return;
        }
        body.unitPrice = p;
      } else {
        body.unitPrice = null;
      }
      const res = await fetchWithSession(`${apiUrl}/api/materials/${materialId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let err = "Не удалось сохранить";
        try {
          const j = await res.json();
          if (typeof j.error === "string") err = j.error;
        } catch {
          // ignore
        }
        setMessage(err);
        return;
      }
      setMessage("Сохранено");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function addSynonym() {
    if (!canWrite || !newSynonym.trim()) return;
    const res = await fetchWithSession(`${apiUrl}/api/materials/${materialId}/synonyms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: newSynonym.trim() })
    });
    if (!res.ok) {
      setMessage("Не удалось добавить синоним");
      return;
    }
    const row = (await res.json()) as { id: string; value: string };
    setSynonyms((prev) => [...prev, row]);
    setNewSynonym("");
  }

  async function removeSynonym(synonymId: string) {
    if (!canWrite) return;
    await fetchWithSession(`${apiUrl}/api/materials/${materialId}/synonyms/${synonymId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    setSynonyms((prev) => prev.filter((s) => s.id !== synonymId));
  }

  async function grantAccess() {
    if (!canGrantAccess || !grantUserId || !grantWarehouseId) return;
    setGrantBusy(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/warehouses/${grantWarehouseId}/grant-access`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: grantUserId, section })
      });
      if (!res.ok) {
        let err = "Не удалось выдать доступ";
        try {
          const j = await res.json();
          if (typeof j.error === "string") err = j.error;
        } catch {
          // ignore
        }
        setMessage(err);
        return;
      }
      setMessage("Доступ к объекту выдан сотруднику");
    } finally {
      setGrantBusy(false);
    }
  }

  return (
    <div className="requestMaterialsModalBackdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card requestMaterialsModalCard" onClick={(e) => e.stopPropagation()}>
        <div className="requestMaterialsModalHead">
          <h3 style={{ margin: 0 }}>Карточка материала</h3>
          <button type="button" className="ghostBtn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="requestMaterialsModalBody">
          {loading ? <p className="muted">Загрузка…</p> : null}
          {message ? (
            <p className="muted" style={{ color: message.includes("Сохранено") || message.includes("выдан") ? "#16a34a" : "#b54708" }}>
              {message}
            </p>
          ) : null}
          {!loading ? (
            <>
              <div className="form grid2">
                <label>
                  Наименование
                  <input value={name} disabled={!canWrite} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  Артикул (SKU)
                  <input value={sku} disabled={!canWrite} onChange={(e) => setSku(e.target.value)} />
                </label>
                <label>
                  Ед. изм.
                  <input value={unit} disabled={!canWrite} onChange={(e) => setUnit(e.target.value)} />
                </label>
                <label>
                  Вид
                  <select value={kind} disabled={!canWrite} onChange={(e) => setKind(e.target.value as typeof kind)}>
                    <option value="MATERIAL">Материал</option>
                    <option value="CONSUMABLE">Расходник</option>
                    <option value="WORKWEAR">Спецодежда</option>
                  </select>
                </label>
                <label>
                  Цена за ед., ₽
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={unitPrice}
                    disabled={!canWrite}
                    onChange={(e) => setUnitPrice(e.target.value)}
                  />
                </label>
                <label>
                  Категория
                  <input value={category} disabled={!canWrite} onChange={(e) => setCategory(e.target.value)} />
                </label>
              </div>

              <section style={{ marginTop: 14 }}>
                <h4 style={{ margin: "0 0 6px" }}>Синонимы (фактические названия)</h4>
                <ul className="plainList">
                  {synonyms.map((s) => (
                    <li key={s.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span>{s.value}</span>
                      {canWrite ? (
                        <button type="button" className="ghostBtn" onClick={() => void removeSynonym(s.id)}>
                          Удалить
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {canWrite ? (
                  <div className="toolbar" style={{ marginTop: 6 }}>
                    <input
                      placeholder="Новый синоним…"
                      value={newSynonym}
                      onChange={(e) => setNewSynonym(e.target.value)}
                      style={{ flex: 1, minWidth: 120 }}
                    />
                    <button type="button" className="ghostBtn" onClick={() => void addSynonym()}>
                      Добавить
                    </button>
                  </div>
                ) : null}
              </section>

              {canGrantAccess ? (
                <section className="requestMaterialsDocs" style={{ marginTop: 16 }}>
                  <h4 style={{ margin: 0 }}>Выдать доступ к объекту</h4>
                  <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                    Сотрудник сможет выбрать объект в шапке и работать в разделе {section}.
                  </p>
                  <div className="form grid2">
                    <label>
                      Сотрудник
                      <select value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)}>
                        <option value="">— выберите —</option>
                        {employees.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.fullName}
                            {u.email ? ` (${u.email})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Объект (склад)
                      <select value={grantWarehouseId} onChange={(e) => setGrantWarehouseId(e.target.value)}>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className="ghostBtn"
                    disabled={grantBusy || !grantUserId || !grantWarehouseId}
                    onClick={() => void grantAccess()}
                  >
                    {grantBusy ? "Выдаём…" : "Выдать доступ"}
                  </button>
                </section>
              ) : null}

              <div className="toolbar" style={{ marginTop: 16 }}>
                {canWrite ? (
                  <button type="button" disabled={saving} onClick={() => void saveMaterial()}>
                    {saving ? "Сохранение…" : "Сохранить карточку"}
                  </button>
                ) : (
                  <p className="muted">Нет прав на редактирование материалов (materials.write).</p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
