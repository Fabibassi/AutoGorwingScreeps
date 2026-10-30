import { describe, expect, test } from "vitest";
import {
  creepNeedsBoost,
  pickAvailableBoost,
  shouldOfferBoosts,
} from "../src/labs/boosts";

describe("pickAvailableBoost", () => {
  test("prefers higher-tier upgrade boost", () => {
    expect(
      pickAvailableBoost("upgrade", [{ GH: 100, XGH2O: 30 }]),
    ).toBe("XGH2O");
    expect(pickAvailableBoost("upgrade", [{ GH: 100 }])).toBe("GH");
    expect(pickAvailableBoost("upgrade", [{ energy: 1000 }])).toBeNull();
  });
});

describe("shouldOfferBoosts", () => {
  test("needs a lab and storage above floor", () => {
    expect(
      shouldOfferBoosts({ labCount: 1, storageEnergy: 20_001, floor: 20_000 }),
    ).toBe(true);
    expect(
      shouldOfferBoosts({ labCount: 0, storageEnergy: 50_000, floor: 20_000 }),
    ).toBe(false);
  });
});

describe("creepNeedsBoost", () => {
  test("true when unboosted WORK remains", () => {
    const creep = {
      body: [{ type: "work" }, { type: "work", boost: "GH" }, { type: "move" }],
    } as Creep;
    expect(creepNeedsBoost(creep, "upgrade")).toBe(true);
    const done = {
      body: [{ type: "work", boost: "GH" }, { type: "move" }],
    } as Creep;
    expect(creepNeedsBoost(done, "upgrade")).toBe(false);
  });
});
