import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  membersFromObjectScopes,
  pickAllowedSection,
  resolveAllowedSectionPairs
} from "../lib/objectAccess.js";

describe("objectAccess", () => {
  it("resolveAllowedSectionPairs grants both sections when unrestricted", () => {
    const pairs = resolveAllowedSectionPairs(["wh1"], []);
    assert.equal(pairs.length, 2);
    assert.deepEqual(pairs, [
      { warehouseId: "wh1", section: "SS" },
      { warehouseId: "wh1", section: "EOM" }
    ]);
  });

  it("resolveAllowedSectionPairs respects single section restriction", () => {
    const pairs = resolveAllowedSectionPairs(
      ["wh1"],
      [{ warehouseId: "wh1", section: "SS" }]
    );
    assert.deepEqual(pairs, [{ warehouseId: "wh1", section: "SS" }]);
  });

  it("membersFromObjectScopes maps section users to member rows", () => {
    const members = membersFromObjectScopes(["u1", "u2", "u3"], {
      SS: ["u1"],
      EOM: ["u2"]
    });
    assert.deepEqual(members, [
      { userId: "u1", sections: ["SS"] },
      { userId: "u2", sections: ["EOM"] },
      { userId: "u3", sections: null }
    ]);
  });

  it("pickAllowedSection falls back to first allowed section", () => {
    assert.equal(pickAllowedSection(["EOM"], "SS"), "EOM");
    assert.equal(pickAllowedSection(null, "EOM"), "EOM");
  });
});
