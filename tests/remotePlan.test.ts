import { describe, expect, test } from "vitest";
import {
  clampRemoteHaulerQuota,
  maybeArmRemotePlanPostRcl6,
  parseRemotePlan,
  remoteQuotasForPlan,
  remoteSpawnGatesOk,
  REMOTE_BAKEOFF_WINNER,
  REMOTE_HAULER_CAP,
  REMOTE_PATH_DEFAULT,
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
    expect(q.remoteHauler).toBeLessThanOrEqual(REMOTE_HAULER_CAP);
  });

  test("hauler quota caps long paths so default 50 cannot flood spawn", () => {
    expect(REMOTE_PATH_DEFAULT).toBe(30);
    expect(clampRemoteHaulerQuota(14)).toBe(REMOTE_HAULER_CAP);
    const long = remoteQuotasForPlan("reserved_drop", {
      sources: 2,
      pathLength: 50,
    });
    expect(long.remoteHauler).toBe(REMOTE_HAULER_CAP);
    const mid = remoteQuotasForPlan("reserved_drop", {
      sources: 2,
      pathLength: REMOTE_PATH_DEFAULT,
    });
    expect(mid.remoteHauler).toBeLessThanOrEqual(REMOTE_HAULER_CAP);
    expect(mid.remoteHauler).toBeGreaterThanOrEqual(1);
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
