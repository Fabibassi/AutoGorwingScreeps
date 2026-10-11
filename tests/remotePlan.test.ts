import { describe, expect, test } from "vitest";
import {
  maybeArmRemotePlanPostRcl6,
  parseRemotePlan,
  remoteQuotasForPlan,
  remoteSpawnGatesOk,
  REMOTE_BAKEOFF_WINNER,
} from "../src/earlyGame/remotePlan";

describe("remotePlan", () => {
  test("defaults to off", () => {
    expect(parseRemotePlan(undefined)).toBe("off");
    expect(parseRemotePlan("home_only")).toBe("off");
    expect(parseRemotePlan("drop_unreserved")).toBe("drop_unreserved");
  });

  test("spawn gates require RCL6 + storage floor + active plan", () => {
    expect(
      remoteSpawnGatesOk({
        rcl: 5,
        storageEnergy: 50_000,
        plan: "drop_unreserved",
      }),
    ).toBe(false);
    expect(
      remoteSpawnGatesOk({
        rcl: 6,
        storageEnergy: 10_000,
        plan: "drop_unreserved",
      }),
    ).toBe(false);
    expect(
      remoteSpawnGatesOk({
        rcl: 6,
        storageEnergy: 50_000,
        plan: "off",
      }),
    ).toBe(false);
    expect(
      remoteSpawnGatesOk({
        rcl: 6,
        storageEnergy: 50_000,
        plan: "reserved_container",
      }),
    ).toBe(true);
  });

  test("quotas: reserved needs reserver; off is zero", () => {
    expect(remoteQuotasForPlan("off", { sources: 2, pathLength: 40 })).toEqual({
      remoteMiner: 0,
      remoteHauler: 0,
      reserver: 0,
    });
    const q = remoteQuotasForPlan("reserved_container", {
      sources: 2,
      pathLength: 40,
    });
    expect(q.remoteMiner).toBe(2);
    expect(q.reserver).toBe(1);
    expect(q.remoteHauler).toBeGreaterThanOrEqual(1);
  });

  test("maybeArm sticky-arms bakeoff winner at RCL6 + floor", () => {
    expect(REMOTE_BAKEOFF_WINNER).toBe("reserved_drop");
    expect(
      maybeArmRemotePlanPostRcl6(5, undefined, { storageEnergy: 80_000 }),
    ).toBeUndefined();
    expect(
      maybeArmRemotePlanPostRcl6(6, undefined, { storageEnergy: 10_000 }),
    ).toBeUndefined();
    expect(
      maybeArmRemotePlanPostRcl6(6, "off", { storageEnergy: 80_000 }),
    ).toBeUndefined();
    expect(
      maybeArmRemotePlanPostRcl6(6, undefined, { storageEnergy: 80_000 }),
    ).toBe("reserved_drop");
    expect(
      maybeArmRemotePlanPostRcl6(6, "reserved_drop", { storageEnergy: 80_000 }),
    ).toBeUndefined();
  });
});
