import { describe, expect, test, vi } from "vitest";
import {
  FILLER_PLANS,
  fillerMaxCostForPlan,
  fillerQuotaForPlan,
  maybeArmFillerPlanPostHub,
  parseFillerPlan,
  shouldDeferFatFillerSpawn,
} from "../src/earlyGame/fillerPlan";
import { bodyForRole } from "../src/earlyGame/bodies";
import { fillerTargetCarry, promoteHaulerToFiller } from "../src/spawn";

describe("fillerPlan", () => {
  test("parse defaults to fat (live softlock override)", () => {
    expect(parseFillerPlan(undefined)).toBe("fat");
    expect(parseFillerPlan("nope")).toBe("fat");
    expect(FILLER_PLANS).toContain("thin");
    expect(FILLER_PLANS).toContain("duo_fat");
  });

  test("maybeArmFillerPlanPostHub sticky-arms fat after hub", () => {
    expect(
      maybeArmFillerPlanPostHub(5, undefined, { extensions: 30, towers: 2 }),
    ).toBe("fat");
    expect(
      maybeArmFillerPlanPostHub(5, "fat", { extensions: 30, towers: 2 }),
    ).toBeUndefined();
    expect(
      maybeArmFillerPlanPostHub(5, "thin", { extensions: 30, towers: 2 }),
    ).toBeUndefined();
    expect(
      maybeArmFillerPlanPostHub(5, "duo_fat", { extensions: 30, towers: 2 }),
    ).toBeUndefined();
    expect(
      maybeArmFillerPlanPostHub(5, undefined, { extensions: 29, towers: 2 }),
    ).toBeUndefined();
    expect(
      maybeArmFillerPlanPostHub(4, undefined, { extensions: 30, towers: 2 }),
    ).toBeUndefined();
  });

  test("thin keeps one small filler (maxCost 300)", () => {
    expect(fillerQuotaForPlan("thin")).toBe(1);
    expect(fillerMaxCostForPlan("thin")).toBe(300);
    expect(bodyForRole("filler", 1300, { fillerMaxCost: 300 })).toEqual(
      bodyForRole("hauler", 300),
    );
  });

  test("fat is one larger filler (maxCost 800)", () => {
    expect(fillerQuotaForPlan("fat")).toBe(1);
    expect(fillerMaxCostForPlan("fat")).toBe(800);
    const body = bodyForRole("filler", 1300, { fillerMaxCost: 800 });
    expect(body.filter((p) => p === "carry").length).toBeGreaterThan(3);
  });

  test("duo_fat is two fat fillers", () => {
    expect(fillerQuotaForPlan("duo_fat")).toBe(2);
    expect(fillerMaxCostForPlan("duo_fat")).toBe(800);
  });

  test("fillerTargetCarry matches CARRY+MOVE pairs in budget", () => {
    expect(fillerTargetCarry(300)).toBe(3);
    expect(fillerTargetCarry(800)).toBe(8);
  });

  test("shouldDeferFatFillerSpawn never blocks when zero fillers", () => {
    expect(
      shouldDeferFatFillerSpawn({
        fillerMaxCost: 800,
        energyAvailable: 150,
        liveFillerCount: 0,
        midFillerCount: 0,
        roleWant: 1,
      }),
    ).toBe(false);
    expect(
      shouldDeferFatFillerSpawn({
        fillerMaxCost: 800,
        energyAvailable: 150,
        liveFillerCount: 1,
        midFillerCount: 0,
        roleWant: 1,
      }),
    ).toBe(true);
  });
});

describe("promoteHaulerToFiller", () => {
  test("promotes fattest hauler when no mid filler and ≥2 haulers", () => {
    vi.stubGlobal("CARRY", "carry");
    const room = { name: "W1N1" } as Room;
    const thin = {
      room,
      memory: { role: "hauler" },
      getActiveBodyparts: (p: string) => (p === "carry" ? 2 : 0),
    };
    const fat = {
      room,
      memory: { role: "hauler" },
      getActiveBodyparts: (p: string) => (p === "carry" ? 6 : 0),
    };
    (globalThis as { Game?: unknown }).Game = { creeps: { a: thin, b: fat } };
    expect(promoteHaulerToFiller(room, 8)).toBe(true);
    expect(fat.memory.role).toBe("filler");
  });

  test("emergency: promotes sole thin hauler when zero fillers", () => {
    vi.stubGlobal("CARRY", "carry");
    const room = { name: "W1N1" } as Room;
    const only = {
      room,
      memory: { role: "hauler" },
      getActiveBodyparts: (p: string) => (p === "carry" ? 1 : 0),
    };
    (globalThis as { Game?: unknown }).Game = { creeps: { a: only } };
    expect(promoteHaulerToFiller(room, 8)).toBe(true);
    expect(only.memory.role).toBe("filler");
  });
});
