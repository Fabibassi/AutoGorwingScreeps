import { describe, expect, test } from "vitest";
import {
  parseRemoteVariant,
  REMOTE_VARIANTS,
  tuningForRemoteVariant,
} from "../src/earlyGame/remoteVariant";
import { remoteQuotasForPlan } from "../src/earlyGame/remotePlan";

describe("remoteVariant", () => {
  test("defaults to baseline", () => {
    expect(parseRemoteVariant(undefined)).toBe("baseline");
    expect(REMOTE_VARIANTS).toContain("lean_haul");
  });

  test("fat_hauler raises maxCost; lean_haul cuts seats", () => {
    expect(tuningForRemoteVariant("fat_hauler").haulerMaxCost).toBe(900);
    expect(tuningForRemoteVariant("thin_hauler").haulerMaxCost).toBe(300);
    expect(tuningForRemoteVariant("dual_claim").claimParts).toBe(2);
    const base = remoteQuotasForPlan("reserved_drop", {
      sources: 2,
      pathLength: 90,
      haulerQuotaScale: 1,
    });
    const lean = remoteQuotasForPlan("reserved_drop", {
      sources: 2,
      pathLength: 90,
      haulerQuotaScale: 0.7,
    });
    expect(lean.remoteHauler).toBeLessThanOrEqual(base.remoteHauler);
  });
});
