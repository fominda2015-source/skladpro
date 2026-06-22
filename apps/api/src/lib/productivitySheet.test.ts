import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseProductivityBuffer } from "./productivitySheet.js";

const FIXTURES = {
  eomBeh: "c:/Users/я/Downloads/Telegram Desktop/Выработка ЭОМ Бехтерева.xlsx",
  eomRec: "c:/Users/я/Downloads/Telegram Desktop/Выработка ЭОМ Речников (2).xlsx",
  ssRec: "c:/Users/я/Downloads/Telegram Desktop/Выработка СС Речников (2).xlsx",
  ssBeh: "c:/Users/я/Downloads/Telegram Desktop/Выработка СС Бехтерева (2).xlsx"
} as const;

function loadFixture(path: string): Buffer | null {
  try {
    return fs.readFileSync(path);
  } catch {
    return null;
  }
}

function maxGroupLevel(rows: ReturnType<typeof parseProductivityBuffer>["rows"]) {
  return rows
    .filter((r) => r.nodeType === "GROUP")
    .reduce((max, r) => Math.max(max, r.level), 0);
}

test("EOM sheets: hierarchy from index labels, no qualification footer", () => {
  for (const key of ["eomBeh", "eomRec"] as const) {
    const buf = loadFixture(FIXTURES[key]);
    if (!buf) return;

    const meta = parseProductivityBuffer(buf);
    const groups = meta.rows.filter((r) => r.nodeType === "GROUP");
    const materials = meta.rows.filter((r) => r.nodeType === "MATERIAL");

    assert.ok(groups.length > 0);
    assert.ok(materials.length > 100);
    assert.ok(maxGroupLevel(meta.rows) <= 6);
    assert.equal(
      groups.some((g) => g.name.toLowerCase().includes("квалификационная")),
      false
    );
    assert.equal(
      groups.some((g) => g.name.toLowerCase().includes("итого")),
      false
    );

    const root = groups[0];
    assert.match(root?.name ?? "", /жил/i);
    assert.equal(root?.level, 0);
  }
});

test("SS sheets: section marker drives hierarchy, summaries skipped", () => {
  for (const key of ["ssRec", "ssBeh"] as const) {
    const buf = loadFixture(FIXTURES[key]);
    if (!buf) return;

    const meta = parseProductivityBuffer(buf);
    const groups = meta.rows.filter((r) => r.nodeType === "GROUP");
    const materials = meta.rows.filter((r) => r.nodeType === "MATERIAL");

    assert.ok(groups.length > 50);
    assert.ok(materials.length > 500);
    assert.ok(maxGroupLevel(meta.rows) <= 4);
    assert.equal(
      groups.some((g) => g.name.toLowerCase().includes("итого")),
      false
    );

    const sections = groups.filter((g) => /^секция\s+\d/i.test(g.name));
    if (sections.length) {
      assert.equal(sections[0]?.level, 2);
    }
  }
});
