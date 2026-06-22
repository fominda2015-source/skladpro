import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEffectivePermissions } from "./access.js";
import { hasGlobalWarehouseAccess } from "./openAccess.js";

describe("access", () => {
  it("getEffectivePermissions returns role permissions without injecting *", () => {
    const perms = getEffectivePermissions(["stocks.read", "issues.read"]);
    assert.deepEqual(perms, ["stocks.read", "issues.read"]);
  });

  it("hasGlobalWarehouseAccess is true only for ADMIN with *", () => {
    assert.equal(hasGlobalWarehouseAccess("ADMIN", ["*"]), true);
    assert.equal(hasGlobalWarehouseAccess("STOREKEEPER", ["*"]), false);
    assert.equal(hasGlobalWarehouseAccess("ADMIN", ["stocks.read"]), false);
    assert.equal(hasGlobalWarehouseAccess("STOREKEEPER", ["stocks.read"]), false);
  });
});
