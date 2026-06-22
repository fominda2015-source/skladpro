import assert from "node:assert/strict";
import test from "node:test";
import {
  formatShortName,
  listPeriodDays,
  resolveReportingPeriod
} from "./timesheetContext.js";

test("formatShortName builds initials", () => {
  assert.equal(formatShortName("Фомин Данила Валерьевич"), "Фомин Д.В.");
  assert.equal(formatShortName("Иванов"), "Иванов");
});

test("resolveReportingPeriod uses month start to today for current month", () => {
  const now = new Date(2026, 5, 14, 12, 0, 0, 0);
  const period = resolveReportingPeriod("2026-06", now);
  assert.equal(period.periodFrom, "2026-06-01");
  assert.equal(period.periodTo, "2026-06-14");
  assert.equal(period.compileDate, "2026-06-14");
});

test("resolveReportingPeriod uses full month for past months", () => {
  const now = new Date(2026, 5, 14, 12, 0, 0, 0);
  const period = resolveReportingPeriod("2026-05", now);
  assert.equal(period.periodFrom, "2026-05-01");
  assert.equal(period.periodTo, "2026-05-31");
  assert.equal(period.compileDate, "2026-05-31");
});

test("listPeriodDays respects upper bound", () => {
  const days = listPeriodDays("2026-06-01", "2026-06-14");
  assert.equal(days.length, 14);
  assert.equal(days[0], "2026-06-01");
  assert.equal(days[13], "2026-06-14");
});
