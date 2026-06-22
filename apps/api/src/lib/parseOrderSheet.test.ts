import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeCatalogNames, cdeMatchesLimitName } from "./parseOrderSheet.js";

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
