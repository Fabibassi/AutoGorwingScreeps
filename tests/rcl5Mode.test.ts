import { describe, expect, test } from "vitest";
import {
  applyRcl5ModeQuotas,
  parseRcl5Mode,
  rcl5ModePausesExtensionSpam,
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

  test("upgrade_rush prioritizes upgraders and pauses extension spam", () => {
    const q = applyRcl5ModeQuotas(base, "upgrade_rush", {
      rcl: 4,
      hasStorage: true,
      hasConstructionSites: true,
      minerWorkParts: 10,
      sources: 2,
    });
    expect(q).toMatchObject({ upgrader: 4, builder: 1, filler: 1 });
    expect(rcl5ModePausesExtensionSpam("upgrade_rush")).toBe(true);
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
        storageEnergy: 2000,
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

  test("early RCL5 hub wave boosts builders under upgrade_rush", () => {
    const q = applyRcl5ModeQuotas(base, "upgrade_rush", {
      rcl: 5,
      hasStorage: true,
      hasConstructionSites: true,
      minerWorkParts: 10,
      sources: 2,
      extensionCount: 15,
      towerCount: 1,
    });
    expect(q).toMatchObject({ upgrader: 2, builder: 3, filler: 1 });
  });
});
