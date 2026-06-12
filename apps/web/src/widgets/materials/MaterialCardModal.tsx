import { useEffect, useState } from "react";
import { parseMaterialQty, sanitizeMaterialQtyInput } from "../../shared/quantity";
import { formatMoneyOrDash } from "../../shared/pricing";

type MaterialDetail = {
  id: string;
  name: string;
  sku?: string | null;
  unit: string;
  kind?: "MATERIAL" | "CONSUMABLE" | "WORKWEAR";
  unitPrice?: number | null;
  priceBasisQty?: number | null;
  category?: string | null;
  synonyms?: Array<{ id: string; value: string }>;
};

type StockLine = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  reserved: number;
  available: number;
};

type Props = {
  materialId: string;
  warehouseId?: string;
  section?: "SS" | "EOM";
  apiUrl: string;
  token: string;
  fetchWithSession: typeof fetch;
  canWrite: boolean;
  canAdjustStock?: boolean;
  onAdjustStockQuantity?: (stockId: string, quantity: number) => Promise<boolean>;
  onClose: () => void;
  onSaved: () => void;
};

export function MaterialCardModal(props: Props) {
  const {
    materialId,
    warehouseId,
    section,
    apiUrl,
    token,
    fetchWithSession,
    canWrite,
    canAdjustStock = false,
    onAdjustStockQuantity,
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
  const [priceBasisQty, setPriceBasisQty] = useState("");
  const [category, setCategory] = useState("");
  const [newSynonym, setNewSynonym] = useState("");
  const [synonyms, setSynonyms] = useState<Array<{ id: string; value: string }>>([]);
  const [saving, setSaving] = useState(false);

  const [stockLine, setStockLine] = useState<StockLine | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockQty, setStockQty] = useState("");
  const [stockSaving, setStockSaving] = useState(false);

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
        setPriceBasisQty(m.priceBasisQty != null ? String(m.priceBasisQty) : "");
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

  useEffect(() => {
    if (!warehouseId || !section) {
      setStockLine(null);
      setStockQty("");
      return;
    }
    let cancelled = false;
    setStockLoading(true);
    void (async () => {
      try {
        const params = new URLSearchParams({
          warehouseId,
          materialId,
          section
        });
        const res = await fetchWithSession(`${apiUrl}/api/stocks?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          if (!cancelled) setStockLine(null);
          return;
        }
        const rows = (await res.json()) as StockLine[];
        const row = rows.find((r) => r.warehouseId === warehouseId) ?? rows[0] ?? null;
        if (cancelled) return;
        setStockLine(row);
        setStockQty(row ? String(parseMaterialQty(row.quantity)) : "0");
      } catch {
        if (!cancelled) setStockLine(null);
      } finally {
        if (!cancelled) setStockLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, fetchWithSession, materialId, section, token, warehouseId]);

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
          setMessage("Сумма должна быть числом ≥ 0");
          return;
        }
        body.unitPrice = p;
        const basisRaw = priceBasisQty.trim().replace(",", ".");
        if (basisRaw) {
          const b = Number(basisRaw);
          if (!Number.isFinite(b) || b <= 0) {
            setMessage("Кол-во для суммы должно быть числом > 0");
            return;
          }
          body.priceBasisQty = b;
        } else {
          body.priceBasisQty = null;
        }
      } else {
        body.unitPrice = null;
        body.priceBasisQty = null;
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

  async function saveStockQuantity() {
    if (!canAdjustStock || !onAdjustStockQuantity || !stockLine) return;
    const next = parseMaterialQty(stockQty);
    if (next === parseMaterialQty(stockLine.quantity)) return;
    setStockSaving(true);
    setMessage("");
    try {
      const ok = await onAdjustStockQuantity(stockLine.id, next);
      if (ok) {
        setStockLine((prev) =>
          prev
            ? {
                ...prev,
                quantity: next,
                available: Math.max(0, next - parseMaterialQty(prev.reserved))
              }
            : prev
        );
        setMessage("Остаток на складе обновлён");
        onSaved();
      }
    } finally {
      setStockSaving(false);
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

  const sectionLabel = section === "EOM" ? "ЭОМ" : section === "SS" ? "СС" : "";

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
            <p className="muted" style={{ color: message.includes("Сохранено") || message.includes("остаток") ? "#16a34a" : "#b54708" }}>
              {message}
            </p>
          ) : null}
          {!loading ? (
            <>
              {warehouseId && section ? (
                <section className="materialCardStockBlock">
                  <h4 style={{ margin: "0 0 8px" }}>
                    Остаток на складе{sectionLabel ? ` · ${sectionLabel}` : ""}
                  </h4>
                  {stockLoading ? (
                    <p className="muted">Загрузка остатка…</p>
                  ) : stockLine ? (
                    <>
                      <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
                        {stockLine.warehouseName} · доступно{" "}
                        {parseMaterialQty(stockLine.available).toLocaleString("ru-RU")}{" "}
                        {unit || "шт"}
                        {parseMaterialQty(stockLine.reserved) > 0
                          ? ` · резерв ${parseMaterialQty(stockLine.reserved).toLocaleString("ru-RU")}`
                          : ""}
                      </p>
                      {canAdjustStock && onAdjustStockQuantity ? (
                        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                          <label style={{ flex: "1 1 140px" }}>
                            Количество на складе ({unit || "шт"})
                            <input
                              type="text"
                              inputMode="numeric"
                              value={stockQty}
                              disabled={stockSaving}
                              onChange={(e) => setStockQty(sanitizeMaterialQtyInput(e.target.value))}
                            />
                          </label>
                          <button
                            type="button"
                            className="secondaryBtn"
                            disabled={
                              stockSaving ||
                              parseMaterialQty(stockQty) === parseMaterialQty(stockLine.quantity)
                            }
                            onClick={() => void saveStockQuantity()}
                          >
                            {stockSaving ? "Сохранение…" : "Сохранить остаток"}
                          </button>
                        </div>
                      ) : (
                        <p className="muted" style={{ margin: 0 }}>
                          Остаток: {parseMaterialQty(stockLine.quantity).toLocaleString("ru-RU")} {unit || "шт"}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      На этом складе в разделе {sectionLabel || section} позиции пока нет — остаток появится после
                      приёмки.
                    </p>
                  )}
                </section>
              ) : null}

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
                  Сумма, ₽
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={unitPrice}
                    disabled={!canWrite}
                    placeholder="Общая стоимость"
                    onChange={(e) => setUnitPrice(e.target.value)}
                  />
                </label>
                <label>
                  За кол-во
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={priceBasisQty}
                    disabled={!canWrite}
                    placeholder="шт"
                    onChange={(e) => setPriceBasisQty(e.target.value)}
                  />
                </label>
                {unitPrice.trim() && priceBasisQty.trim() ? (
                  <p className="muted" style={{ margin: 0, gridColumn: "1 / -1", fontSize: 12 }}>
                    ≈ {formatMoneyOrDash(Number(unitPrice.replace(",", ".")) / Number(priceBasisQty.replace(",", ".")))}{" "}
                    / ед.
                  </p>
                ) : null}
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

              <div className="toolbar" style={{ marginTop: 16 }}>
                {canWrite ? (
                  <button type="button" disabled={saving} onClick={() => void saveMaterial()}>
                    {saving ? "Сохранение…" : "Сохранить карточку"}
                  </button>
                ) : (
                  <p className="muted">
                    Нет права на редактирование карточек материалов. Выдайте его в «Доступы» → карточка пользователя →
                    «Доступы на действия».
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
