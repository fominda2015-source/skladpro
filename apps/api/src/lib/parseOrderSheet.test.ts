import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  analyzeCatalogNames,
  cdeMatchesLimitName,
  parseOrderNumberFromFileName,
  parseOrderSheet,
  scanOrderNumberFromSheet
} from "./parseOrderSheet.js";

describe("analyzeCatalogNames", () => {
  it("без замены, когда N совпадает с C/D/E", () => {
    const meta = analyzeCatalogNames(
      "Кабель ВВГ 3х2.5",
      "",
      "",
      "Кабель ВВГ 3х2.5",
      "Кабель ВВГ 3х2.5",
      ""
    );
    assert.equal(meta.renameLimitToO, false);
    assert.equal(meta.limitDisplayName, "Кабель ВВГ 3х2.5");
  });

  it("замена на O, когда N отличается от заказа (order-150423: кабель Folan вместо ParLan)", () => {
    const c = "Кабель абонентский Folan U/UTP Cat5e PVC нг(А)-LS 4х2х0,52";
    const n = 'Кабель абонентский ParLan U/UTP Cat5e PVCLSнг(А)-LS 4x2x0,52 ТПД "Паритет"';
    const o = "Кабель абонентский Folan U/UTP Cat5e PVC нг(А)-LS 4х2х0,52";
    assert.equal(cdeMatchesLimitName(c, "", "", n), false);
    const meta = analyzeCatalogNames(c, "", "", n, o, "комментарий");
    assert.equal(meta.renameLimitToO, true);
    assert.equal(meta.limitDisplayName, o);
    assert.equal(meta.nameAlertNote, "комментарий");
  });

  it("замена на C/D/E, когда N отличается и O пусто", () => {
    const c = "Гофрированная труба Рувинил 20 мм";
    const n = "Труба гофрированная ПВХ 16 мм";
    const meta = analyzeCatalogNames(c, "", "", n, "", "");
    assert.equal(meta.renameLimitToO, true);
    assert.equal(meta.limitDisplayName, c);
  });
});

describe("order number extraction", () => {
  it("из имени файла order-150423.xlsx", () => {
    assert.equal(parseOrderNumberFromFileName("order-150423.xlsx"), "150423");
  });

  it("из ячейки под подписью «Номер заявки»", () => {
    const grid = [
      ["", "", "", "", "Номер заявки", "Отсрочка"],
      ["", "", "", "", "150423", "30"]
    ];
    const getCell = (r: number, c: number) => grid[r]?.[c] ?? "";
    assert.equal(scanOrderNumberFromSheet(getCell, 1, 5), "150423");
  });

  it("парсит order-150423.xlsx с номером 150423", () => {
    const filePath = "C:/Users/я/Desktop/order-150423.xlsx";
    let buf: Buffer;
    try {
      buf = readFileSync(filePath);
    } catch {
      return;
    }
    const parsed = parseOrderSheet(buf, "order-150423.xlsx");
    assert.equal(parsed.orderNumber, "150423");
  });
});
