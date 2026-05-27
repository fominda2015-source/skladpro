import { useMemo, useState } from "react";

// Универсальная строка таблицы для модала.
type MaterialRow = {
  num: number;
  name: string;
  sku?: string;
  unit?: string;
  quantity: number;
  acceptedQty?: number;
  factLabel?: string;
};

type IssueLike = {
  number: string;
  status: string;
  createdAt: string;
  warehouse?: { name: string } | null;
  project?: { name: string } | null;
  responsibleName?: string | null;
  actualRecipientName?: string | null;
  requestedBy?: { fullName: string };
  items?: Array<{
    id: string;
    quantity: string | number;
    factLabel?: string | null;
    material?: { name: string; sku?: string | null; unit?: string | null } | null;
  }>;
  toolItems?: Array<{
    id: string;
    tool?: { name: string; inventoryNumber: string; status?: string } | null;
  }>;
};

type ReceiptLike = {
  number: string;
  status: string;
  createdAt: string;
  section?: string;
  warehouse?: { name: string } | null;
  sourceFileName?: string | null;
  items?: Array<{
    id: string;
    sourceName: string;
    sourceUnit?: string | null;
    quantity: string | number;
    acceptedQty?: string | number | null;
    mappedMaterial?: { name: string; unit: string } | null;
  }>;
};

type Props =
  | { kind: "issue"; row: IssueLike; onClose: () => void }
  | { kind: "receipt"; row: ReceiptLike; onClose: () => void };

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function RequestMaterialsModal(props: Props) {
  const { onClose } = props;
  const [highlight, setHighlight] = useState("");

  const rows: MaterialRow[] = useMemo(() => {
    if (props.kind === "issue") {
      const items = props.row.items ?? [];
      return items.map((it, idx) => ({
        num: idx + 1,
        name: it.factLabel || it.material?.name || "—",
        sku: it.material?.sku || "",
        unit: it.material?.unit || "шт",
        quantity: num(it.quantity),
        factLabel: it.factLabel || undefined
      }));
    }
    const items = props.row.items ?? [];
    return items.map((it, idx) => ({
      num: idx + 1,
      name: it.mappedMaterial?.name || it.sourceName,
      unit: it.mappedMaterial?.unit || it.sourceUnit || "шт",
      quantity: num(it.quantity),
      acceptedQty: num(it.acceptedQty),
      factLabel: it.sourceName
    }));
  }, [props]);

  const tools =
    props.kind === "issue"
      ? (props.row.toolItems || []).map((t, idx) => ({
          num: idx + 1,
          name: t.tool?.name || "—",
          inv: t.tool?.inventoryNumber || "",
          status: t.tool?.status || ""
        }))
      : [];

  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
  const totalAccepted = rows.reduce((s, r) => s + (r.acceptedQty || 0), 0);
  const totalPct = totalQty > 0 ? Math.round((totalAccepted / totalQty) * 1000) / 10 : 0;

  function copyAsTsv() {
    const headerCells =
      props.kind === "receipt"
        ? ["№", "Материал", "Ед.", "Количество", "Принято", "Исходное название"]
        : ["№", "Материал", "Артикул", "Ед.", "Количество", "Фактическое название"];
    const lines: string[] = [headerCells.join("\t")];
    for (const r of rows) {
      if (props.kind === "receipt") {
        lines.push(
          [
            r.num,
            r.name,
            r.unit ?? "",
            r.quantity,
            r.acceptedQty ?? 0,
            r.factLabel || ""
          ].join("\t")
        );
      } else {
        lines.push(
          [r.num, r.name, r.sku || "", r.unit ?? "", r.quantity, r.factLabel || ""].join("\t")
        );
      }
    }
    void navigator.clipboard?.writeText(lines.join("\n")).then(
      () => setHighlight("Таблица скопирована в буфер обмена (TSV)"),
      () => setHighlight("Не удалось скопировать")
    );
    setTimeout(() => setHighlight(""), 2500);
  }

  function printTable() {
    window.print();
  }

  const filterStr = useMemo(() => {
    return (s: string) =>
      String(s || "").replace(/[\u0000-\u001f]/g, "").trim();
  }, []);

  const title =
    props.kind === "issue"
      ? `Заявка на выдачу ${filterStr(props.row.number)}`
      : `Заявка на приход ${filterStr(props.row.number)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        padding: 16
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 1100, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 8
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {props.kind === "issue" ? (
                <>
                  Статус: {props.row.status}
                  {props.row.warehouse?.name ? ` · Склад: ${props.row.warehouse.name}` : ""}
                  {props.row.project?.name ? ` · Проект: ${props.row.project.name}` : ""}
                  {props.row.responsibleName ? ` · Ответств.: ${props.row.responsibleName}` : ""}
                  {props.row.actualRecipientName ? ` · Получил: ${props.row.actualRecipientName}` : ""}
                  {" · Создана: "}
                  {new Date(props.row.createdAt).toLocaleString()}
                </>
              ) : (
                <>
                  Статус: {props.row.status}
                  {props.row.warehouse?.name ? ` · Склад: ${props.row.warehouse.name}` : ""}
                  {props.row.section ? ` · Раздел: ${props.row.section}` : ""}
                  {props.row.sourceFileName ? ` · Файл: ${props.row.sourceFileName}` : ""}
                  {" · Создана: "}
                  {new Date(props.row.createdAt).toLocaleString()}
                </>
              )}
            </p>
          </div>
          <div className="toolbar" style={{ flexWrap: "wrap", gap: 6 }}>
            <button type="button" className="ghostBtn" onClick={copyAsTsv}>
              Копировать (TSV)
            </button>
            <button type="button" className="ghostBtn" onClick={printTable}>
              Печать
            </button>
            <button type="button" className="ghostBtn" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>

        {highlight ? (
          <p className="muted" style={{ margin: "0 0 6px", color: "#16a34a" }}>
            {highlight}
          </p>
        ) : null}

        <div style={{ overflow: "auto", flex: 1 }}>
          {rows.length ? (
            <table className="limitMaterialsTable" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th className="num" style={{ width: 32 }}>№</th>
                  <th>Материал</th>
                  {props.kind === "issue" ? <th>Артикул</th> : null}
                  <th className="num">Ед.</th>
                  <th className="num">Количество</th>
                  {props.kind === "receipt" ? <th className="num">Принято</th> : null}
                  {props.kind === "receipt" ? <th>Исходное название</th> : null}
                  {props.kind === "issue" ? <th>Фактич. название</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${props.kind}-row-${r.num}`}>
                    <td className="num">{r.num}</td>
                    <td className="matName" title={r.name}>{r.name}</td>
                    {props.kind === "issue" ? <td>{r.sku || ""}</td> : null}
                    <td className="num">{r.unit}</td>
                    <td className="num">
                      {r.quantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                    </td>
                    {props.kind === "receipt" ? (
                      <td className="num">
                        {(r.acceptedQty || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                      </td>
                    ) : null}
                    {props.kind === "receipt" ? (
                      <td className="matName muted" title={r.factLabel || ""}>
                        {r.factLabel || ""}
                      </td>
                    ) : null}
                    {props.kind === "issue" ? (
                      <td className="matName muted" title={r.factLabel || ""}>
                        {r.factLabel || ""}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={props.kind === "receipt" ? 3 : 3} style={{ fontWeight: 700 }}>
                    Итого
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {totalQty.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                  </td>
                  {props.kind === "receipt" ? (
                    <>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {totalAccepted.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                      </td>
                      <td className="muted" style={{ fontSize: 11 }}>
                        принято {totalPct}%
                      </td>
                    </>
                  ) : (
                    <td />
                  )}
                </tr>
              </tfoot>
            </table>
          ) : (
            <p className="muted">В заявке нет позиций.</p>
          )}

          {tools.length ? (
            <>
              <h4 style={{ marginTop: 16, marginBottom: 6 }}>Инструменты в заявке</h4>
              <table className="limitMaterialsTable" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th className="num" style={{ width: 32 }}>№</th>
                    <th>Инструмент</th>
                    <th className="num">Инв. №</th>
                    <th className="num">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((t) => (
                    <tr key={`tool-${t.num}`}>
                      <td className="num">{t.num}</td>
                      <td className="matName" title={t.name}>{t.name}</td>
                      <td className="num">{t.inv}</td>
                      <td className="num">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
