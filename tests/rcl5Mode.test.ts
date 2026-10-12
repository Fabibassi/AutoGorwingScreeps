import { describe, expect, test } from "vitest";
import {
  applyRcl5ModeQuotas,
  applyRcl5PlanQuotas,
  maybeArmRcl5AftercareMode,
  maybeArmRcl5PostHubMode,
  maybeArmRcl5PostHubPlan,
  maybeArmRcl6SpendMode,
  maybeDisarmRcl6SpendMode,
  parseRcl5Mode,
  rcl5ModePausesExtensionSpam,
  shouldPlaceRcl5Links,
} from "../src/earlyGame/rcl5Mode";
import { constructionPriority, desiredCreeps } from "../src/earlyGame";

const base = {
  harvester: 0,
  miner: 2,
  hauler: 2,
  upgrader: 1,
  builder: 4,
  filler: 0,
};

describe("rcl5Mode", () => {
  test("parse defaults to upgrade_rush (bench winner)", () => {
    expect(parseRcl5Mode(undefined)).toBe("upgrade_rush");
    expect(parseRcl5Mode("hub_spend")).toBe("hub_spend");
  });

  test("maybeArmRcl5AftercareMode switches climb default to build_heavy at RCL≥5", () => {
    expect(maybeArmRcl5AftercareMode(4, "upgrade_rush")).toBeUndefined();
    expect(maybeArmRcl5AftercareMode(4, undefined)).toBeUndefined();
    expect(maybeArmRcl5AftercareMode(5, undefined)).toBe("build_heavy");
    expect(maybeArmRcl5AftercareMode(5, "upgrade_rush")).toBe("build_heavy");
    expect(maybeArmRcl5AftercareMode(5, "build_heavy")).toBeUndefined();
    expect(maybeArmRcl5AftercareMode(5, "hub_spend")).toBeUndefined();
    expect(maybeArmRcl5AftercareMode(6, "")).toBe("build_heavy");
  });

  test("maybeArmRcl5PostHubMode switches build_heavy → fat_first when hub ready", () => {
    expect(
      maybeArmRcl5PostHubMode(5, "build_heavy", { extensions: 29, towers: 2 }),
    ).toBeUndefined();
    expect(
      maybeArmRcl5PostHubMode(5, "build_heavy", { extensions: 30, towers: 1 }),
    ).toBeUndefined();
    expect(
      maybeArmRcl5PostHubMode(5, "build_heavy", { extensions: 30, towers: 2 }),
    ).toBe("fat_first");
    expect(
      maybeArmRcl5PostHubMode(5, "fat_first", { extensions: 30, towers: 2 }),
    ).toBeUndefined();
    expect(
      maybeArmRcl5PostHubMode(5, "upgrade_rush", { extensions: 30, towers: 2 }),
    ).toBeUndefined();
    expect(
      maybeArmRcl5PostHubMode(4, "build_heavy", { extensions: 30, towers: 2 }),
    ).toBeUndefined();
  });

  test("maybeArmRcl6SpendMode switches fat_first → upgrade_rush at RCL6 with remotes", () => {
    const fat = { storageEnergy: 50_000 };
    expect(
      maybeArmRcl6SpendMode(5, "fat_first", {
        remotePlan: "reserved_drop",
        ...fat,
      }),
    ).toBeUndefined();
    expect(
      maybeArmRcl6SpendMode(6, "fat_first", { remotePlan: "off", ...fat }),
    ).toBeUndefined();
    expect(
      maybeArmRcl6SpendMode(6, "fat_first", {
        remotePlan: "reserved_drop",
        ...fat,
      }),
    ).toBe("upgrade_rush");
    expect(
      maybeArmRcl6SpendMode(6, "fat_first", {
        remotePlan: undefined,
        ...fat,
      }),
    ).toBe("upgrade_rush");
    expect(
      maybeArmRcl6SpendMode(6, "upgrade_rush", {
        remotePlan: "reserved_drop",
        ...fat,
      }),
    ).toBeUndefined();
    expect(
      maybeArmRcl6SpendMode(6, "build_heavy", {
        remotePlan: "reserved_drop",
        ...fat,
      }),
    ).toBeUndefined();
    expect(
      maybeArmRcl6SpendMode(6, "fat_first", {
        remotePlan: "reserved_drop",
        storageEnergy: 20_000,
      }),
    ).toBeUndefined();
  });

  test("maybeDisarmRcl6SpendMode drops upgrade_rush → fat_first under floor", () => {
    expect(
      maybeDisarmRcl6SpendMode(6, "upgrade_rush", {
        remotePlan: "reserved_drop",
        storageEnergy: 20_000,
      }),
    ).toBe("fat_first");
    expect(
      maybeDisarmRcl6SpendMode(6, "upgrade_rush", {
        remotePlan: "reserved_drop",
        storageEnergy: 50_000,
      }),
    ).toBeUndefined();
    expect(
      maybeDisarmRcl6SpendMode(6, "fat_first", {
        remotePlan: "reserved_drop",
        storageEnergy: 0,
      }),
    ).toBeUndefined();
  });

  test("maybeArmRcl5PostHubPlan arms link_boost after hub (gameplan confirm)", () => {
    expect(
      maybeArmRcl5PostHubPlan(5, undefined, { extensions: 30, towers: 2 }),
    ).toBe("link_boost");
    expect(
      maybeArmRcl5PostHubPlan(5, "fat_first", { extensions: 30, towers: 2 }),
    ).toBe("link_boost");
    expect(
      maybeArmRcl5PostHubPlan(5, "link_boost", { extensions: 30, towers: 2 }),
    ).toBeUndefined();
    expect(
      maybeArmRcl5PostHubPlan(5, "none", { extensions: 30, towers: 2 }),
    ).toBeUndefined();
    expect(
      maybeArmRcl5PostHubPlan(5, undefined, { extensions: 29, towers: 2 }),
    ).toBeUndefined();
  });

  test("upgrade_rush prioritizes upgraders and pauses extension spam", () => {
    const q = applyRcl5ModeQuotas(base, "upgrade_rush", {
      rcl: 4,
      hasStorage: true,
      hasConstructionSites: true,
      minerWorkParts: 10,
      sources: 2,
      storageEnergy: 50_000,
    });
    expect(q).toMatchObject({ upgrader: 4, builder: 1, filler: 1 });
    expect(rcl5ModePausesExtensionSpam("upgrade_rush")).toBe(true);
  });

  test("storage floor throttles upgrade_rush to 1 upgrader", () => {
    const q = applyRcl5ModeQuotas(base, "upgrade_rush", {
      rcl: 5,
      hasStorage: true,
      hasConstructionSites: false,
      minerWorkParts: 10,
      sources: 2,
      extensionCount: 30,
      towerCount: 2,
      storageEnergy: 15_000,
    });
    expect(q).toMatchObject({ upgrader: 1, builder: 0, filler: 1 });
  });

  test("shouldPlaceRcl5Links only for explicit link_boost after hub", () => {
    expect(
      shouldPlaceRcl5Links({
        plan: "link_boost",
        rcl: 5,
        extensions: 30,
        towers: 2,
        linkCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldPlaceRcl5Links({
        plan: "none",
        rcl: 5,
        extensions: 30,
        towers: 2,
        linkCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldPlaceRcl5Links({
        plan: undefined,
        rcl: 5,
        extensions: 30,
        towers: 2,
        linkCount: 0,
      }),
    ).toBe(false);
  });

  test("applyRcl5PlanQuotas forces builders during link CAPEX", () => {
    const capex = applyRcl5PlanQuotas(base, "link_boost", {
      linksBuilt: 0,
      hasConstructionSites: true,
    });
    expect(capex).toMatchObject({ upgrader: 1, builder: 3 });
    expect(
      applyRcl5PlanQuotas(base, "link_boost", {
        linksBuilt: 2,
        hasConstructionSites: false,
      }),
    ).toEqual(base);
  });

  test("fat_first waits for 5W miners before upgrade pressure", () => {
    const thin = applyRcl5ModeQuotas(base, "fat_first", {
      rcl: 4,
      hasStorage: true,
      hasConstructionSites: false,
      minerWorkParts: 4,
      sources: 2,
    });
    expect(thin.upgrader).toBe(1);
    const fat = applyRcl5ModeQuotas(base, "fat_first", {
      rcl: 4,
      hasStorage: true,
      hasConstructionSites: false,
      minerWorkParts: 10,
      sources: 2,
    });
    expect(fat.upgrader).toBe(3);
  });

  test("build_heavy keeps extension flood", () => {
    const q = applyRcl5ModeQuotas(base, "build_heavy", {
      rcl: 4,
      hasStorage: true,
      hasConstructionSites: true,
      minerWorkParts: 10,
      sources: 2,
    });
    expect(q).toMatchObject({ upgrader: 1, builder: 4, filler: 1 });
    expect(rcl5ModePausesExtensionSpam("build_heavy")).toBe(false);
  });

  test("desiredCreeps honors rcl5Mode with storage", () => {
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 10,
        hasStorage: true,
        storageEnergy: 25_000,
        minerWorkParts: 10,
        energyCapacityAvailable: 1300,
        rcl5Mode: "upgrade_rush",
      }),
    ).toMatchObject({ upgrader: 4, filler: 1, builder: 1 });
  });

  test("constructionPriority skips extensions under upgrade_rush", () => {
    const queue = constructionPriority(4, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: true,
      roadSitesAllowed: true,
      extensionCount: 0,
      towerCount: 1,
      minerWorkParts: 10,
      rcl5Mode: "upgrade_rush",
    });
    expect(queue.filter((s) => s === "extension")).toHaveLength(0);
    expect(queue.includes("road")).toBe(false);
  });

  test("constructionPriority resumes extensions at RCL5 under upgrade_rush", () => {
    const queue = constructionPriority(5, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: true,
      roadSitesAllowed: true,
      extensionCount: 15,
      extensionBuilt: 15,
      towerCount: 1,
      minerWorkParts: 10,
      rcl5Mode: "upgrade_rush",
    });
    expect(queue.filter((s) => s === "extension").length).toBeGreaterThan(0);
    expect(queue.includes("tower")).toBe(true);
  });

  test("early RCL5 hub wave uses build_heavy quotas (aftercare winner)", () => {
    const q = applyRcl5ModeQuotas(base, "upgrade_rush", {
      rcl: 5,
      hasStorage: true,
      hasConstructionSites: true,
      minerWorkParts: 10,
      sources: 2,
      extensionCount: 15,
      towerCount: 1,
    });
    expect(q).toMatchObject({ upgrader: 1, builder: 4, filler: 1 });
  });

  test("hub wave keeps builders even when constructionSites briefly hit 0", () => {
    const q = applyRcl5ModeQuotas(base, "build_heavy", {
      rcl: 5,
      hasStorage: true,
      hasConstructionSites: false,
      minerWorkParts: 10,
      sources: 2,
      extensionCount: 23,
      towerCount: 1,
    });
    expect(q).toMatchObject({ upgrader: 1, builder: 4, filler: 1 });
  });
});
