import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { issueWhereFromScope, operationWhereFromScope } from "../lib/dataScope.js";

describe("dataScope", () => {
  const emptyScope = {
    unrestricted: false,
    warehouseIds: [] as string[],
    projectIds: null,
    sectionScopes: [],
    allowedSectionPairs: []
  };

  it("denies operations when scope has no warehouses", () => {
    assert.deepEqual(operationWhereFromScope(emptyScope), { warehouseId: { in: [] } });
  });

  it("denies issues when scope has no warehouses or sections", () => {
    assert.deepEqual(issueWhereFromScope(emptyScope), { warehouseId: { in: [] } });
  });
});
