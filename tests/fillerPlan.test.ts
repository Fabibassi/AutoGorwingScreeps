import { describe, expect, test } from "vitest";
import {
  FILLER_PLANS,
  fillerMaxCostForPlan,
  fillerQuotaForPlan,
  maybeArmFillerPlanPostHub,
  parseFillerPlan,
} from "../src/earlyGame/fillerPlan";
import { bodyForRole } from "../src/earlyGame/bodies";
import { fillerTargetCarry } from "../src/spawn";

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
});
