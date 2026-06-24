import { useMemo, useState } from "react";
import { PendingFilesPicker } from "../../shared/PendingFilesPicker";
import { parseMaterialQty, MATERIAL_QTY_MIN, MATERIAL_QTY_STEP } from "../../shared/quantity";
import { formatReceiptLineUnitCost } from "../receipts/receiptLabels";
import {
  WAREHOUSE_RECEIPT_CATEGORY_OPTIONS,
  type WarehouseReceiptCategory
} from "./warehouseStockCategory";

export type WarehouseBatchLine = {
  materialName: string;
  quantity: number;
  unit: string;
  warehouseCategory: WarehouseReceiptCategory;
  unitPrice?: number | null;
  storagePlace?: string | null;
};

type Props = {
  open: boolean;
  busy: boolean;
  message: string;
  sectionLabel: string;
  warehouses: Array<{ id: string; name: string }>;
  warehouseId: string;
  onWarehouseIdChange: (id: string) => void;
  section: "SS" | "EOM";
  safeName: (name: string) => string;
  onClose: () => void;
  onSubmitLines: (lines: WarehouseBatchLine[], batchId: string) => Promise<boolean>;
  onUploadDocs: (
    batchId: string,
    warehouseId: string,
    title: string,
    comment: string,
    documentDate: string,
    files: File[]
  ) => Promise<boolean>;
};

function parseOptionalPrice(raw: string): { ok: true; value: number | null } | { ok: false } {
  const priceRaw = raw.trim().replace(",", ".");
  if (priceRaw === "") return { ok: true, value: null };
  const p = Number(priceRaw);
  if (!Number.isFinite(p) || p < 0) return { ok: false };
  return { ok: true, value: p };
}

export function ManualBatchAddModal({
  open,
  busy,
  message,
  sectionLabel,
  warehouses,
  warehouseId,
  onWarehouseIdChange,
  section,
  safeName,
  onClose,
  onSubmitLines,
  onUploadDocs
}: Props) {
  const [step, setStep] = useState<"items" | "documents">("items");
  const [batchId, setBatchId] = useState("");
  const [pending, setPending] = useState<WarehouseBatchLine[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("шт");
  const [category, setCategory] = useState<WarehouseReceiptCategory>("EQUIPMENT");
  const [unitPrice, setUnitPrice] = useState("");
  const [storagePlace, setStoragePlace] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docComment, setDocComment] = useState("");
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [docFiles, setDocFiles] = useState<File[]>([]);

  const sectionRu = section === "SS" ? "СС" : "ЭОМ";

  function resetForm() {
    setName("");
    setQty("1");
    setUnit("шт");
    setUnitPrice("");
    setStoragePlace("");
    setLocalMessage("");
  }

  function resetAll() {
    setStep("items");
    setBatchId("");
    setPending([]);
    resetForm();
    setDocTitle("");
    setDocComment("");
    setDocDate(new Date().toISOString().slice(0, 10));
    setDocFiles([]);
  }

  function close() {
    if (busy) return;
    resetAll();
    onClose();
  }

  function buildCurrentLine(): WarehouseBatchLine | null {
    if (!name.trim()) {
      setLocalMessage("Укажите название материала.");
      return null;
    }
    const quantity = parseMaterialQty(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setLocalMessage("Укажите положительное количество.");
      return null;
    }
    const parsedPrice = parseOptionalPrice(unitPrice);
    if (!parsedPrice.ok) {
      setLocalMessage("Некорректная цена.");
      return null;
    }
    return {
      materialName: name.trim(),
      quantity,
      unit: (unit.trim() || "шт").slice(0, 64),
      warehouseCategory: category,
      unitPrice: parsedPrice.value,
      storagePlace: storagePlace.trim() || null
    };
  }

  function onAddMore() {
    const line = buildCurrentLine();
    if (!line) return;
    setPending((prev) => [...prev, line]);
    resetForm();
  }

  async function onSubmitAll() {
    const lines = [...pending];
    const current = buildCurrentLine();
    if (current) lines.push(current);
    if (!lines.length) {
      setLocalMessage("Добавьте хотя бы одну позицию.");
      return;
    }
    if (!warehouseId) {
      setLocalMessage("Выберите объект.");
      return;
    }
    const nextBatchId = crypto.randomUUID();
    const ok = await onSubmitLines(lines, nextBatchId);
    if (!ok) return;
    setBatchId(nextBatchId);
    setPending([]);
    resetForm();
    setDocTitle(lines.length === 1 ? lines[0].materialName : `Ручное добавление (${lines.length} поз.)`);
    setStep("documents");
  }

  async function onFinishDocs(skip: boolean) {
    if (!skip && docFiles.length) {
      if (!docTitle.trim()) {
        setLocalMessage("Укажите название для документов.");
        return;
      }
      const ok = await onUploadDocs(batchId, warehouseId, docTitle.trim(), docComment.trim(), docDate, docFiles);
      if (!ok) return;
    }
    resetAll();
    onClose();
  }

  const shownMessage = localMessage || message;

  const pendingSummary = useMemo(
    () =>
      pending.map((line, i) => (
        <li key={`pending-${i}`}>
          <strong>{line.materialName}</strong> — {line.quantity} {line.unit}
          {line.unitPrice != null ? (
            <>
              {" "}
              · {line.unitPrice} ₽
              {line.quantity > 1 ? (
                <span className="muted">
                  {" "}
                  ({formatReceiptLineUnitCost(line.unitPrice, line.quantity)} ₽/ед.)
                </span>
              ) : null}
            </>
          ) : null}
        </li>
      )),
    [pending]
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 55,
        padding: 16
      }}
      onClick={() => close()}
    >
      <div
        className="card warehouseManualStockCard"
        style={{ maxWidth: 560, width: "100%", maxHeight: "90vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0 }}>
            {step === "items" ? "Добавить материал вручную" : "Документы по добавлению"}
          </h3>
          <button type="button" className="ghostBtn" disabled={busy} onClick={() => close()}>
            Закрыть
          </button>
        </div>

        {step === "items" ? (
          <>
            <p className="muted" style={{ margin: "0 0 10px" }}>
              Создаётся новая карточка номенклатуры и сразу увеличивается остаток по разделу {sectionRu} (
              {sectionLabel}). Можно добавить несколько позиций, затем приложить УПД, счёт или другие документы.
            </p>
            {shownMessage ? <p className="muted">{shownMessage}</p> : null}
            {pending.length > 0 ? (
              <div className="adminInsetCard" style={{ marginBottom: 10, padding: "8px 12px" }}>
                <p className="muted" style={{ margin: "0 0 6px", fontSize: 12 }}>
                  В очереди ({pending.length}):
                </p>
                <ul className="plainList" style={{ margin: 0, fontSize: 13 }}>
                  {pendingSummary}
                </ul>
              </div>
            ) : null}
            <div className="form grid2">
              <label>
                Объект (склад)
                <select value={warehouseId} onChange={(e) => onWarehouseIdChange(e.target.value)} disabled={!warehouses.length}>
                  {warehouses.map((w) => (
                    <option key={`man-wh-${w.id}`} value={w.id}>
                      {safeName(w.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Количество
                <input
                  type="number"
                  min={MATERIAL_QTY_MIN}
                  step={MATERIAL_QTY_STEP}
                  value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Название материала
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Перфоратор (аренда)" />
              </label>
              <label>
                Категория
                <select value={category} onChange={(e) => setCategory(e.target.value as WarehouseReceiptCategory)}>
                  {WAREHOUSE_RECEIPT_CATEGORY_OPTIONS.map((o) => (
                    <option key={`wh-cat-${o.value}`} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label title="Общая сумма за всё количество; ₽/ед. = сумма ÷ кол-во">
                Сумма, ₽ (за всё кол-во, необязательно)
                <input
                  type="text"
                  inputMode="decimal"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="сумма"
                />
                {parseMaterialQty(qty) > 0 &&
                Number(unitPrice) > 0 &&
                Number.isFinite(Number(unitPrice.replace(",", "."))) ? (
                  <span className="muted" style={{ fontSize: 11, display: "block", marginTop: 2 }}>
                    {formatReceiptLineUnitCost(Number(unitPrice.replace(",", ".")), parseMaterialQty(qty))} ₽/ед.
                  </span>
                ) : null}
              </label>
              <label>
                Ед. измерения
                <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="шт" />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Место хранения
                <input
                  value={storagePlace}
                  onChange={(e) => setStoragePlace(e.target.value)}
                  placeholder="Стеллаж, ячейка…"
                />
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="ghostBtn" disabled={busy || !name.trim()} onClick={() => onAddMore()}>
                Добавить ещё
              </button>
              <button
                type="button"
                className="primaryBtn"
                disabled={busy || (!name.trim() && !pending.length)}
                onClick={() => void onSubmitAll()}
              >
                {busy ? "Сохранение…" : "Добавить на склад"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: "0 0 10px" }}>
              Позиции добавлены. Приложите УПД, счёт или другие документы по этому добавлению (необязательно).
            </p>
            {shownMessage ? <p className="muted">{shownMessage}</p> : null}
            <div className="form">
              <label>
                Название
                <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Например: УПД от поставщика" />
              </label>
              <label>
                Дата документа
                <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
              </label>
              <label>
                Комментарий
                <textarea value={docComment} onChange={(e) => setDocComment(e.target.value)} rows={2} />
              </label>
              <label>
                Файлы
                <PendingFilesPicker files={docFiles} onChange={setDocFiles} addLabel="Добавить файлы" />
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="ghostBtn" disabled={busy} onClick={() => void onFinishDocs(true)}>
                Пропустить
              </button>
              <button
                type="button"
                className="primaryBtn"
                disabled={busy || (docFiles.length > 0 && !docTitle.trim())}
                onClick={() => void onFinishDocs(false)}
              >
                {busy ? "Загрузка…" : docFiles.length ? "Сохранить с документами" : "Готово"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
