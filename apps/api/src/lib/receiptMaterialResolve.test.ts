import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalReceiptMaterialName,
  materialNamesEquivalent,
  receiptCatalogMeta
} from "./receiptMaterialResolve.js";

test("canonicalReceiptMaterialName prefers column O when renamed", () => {
  const item = {
    sourceName: "Гофрированная труба Рувинил 20 мм",
    limitCatalogNameN: "Труба из заявки N",
    limitCatalogNameO: "Труба гофрированная ПВХ ф16мм Руфинил"
  };
  const meta = receiptCatalogMeta(item);
  assert.equal(meta.renameLimitToO, true);
  assert.equal(canonicalReceiptMaterialName(item), "Труба гофрированная ПВХ ф16мм Руфинил");
});

test("materialNamesEquivalent matches by shared article number", () => {
  assert.equal(
    materialNamesEquivalent(
      "Труба гофрированная ПВХ 16 мм Рувинил 11601",
      "Труба гофрированная ПВХ ф16мм Руфинил 11601"
    ),
    true
  );
});
