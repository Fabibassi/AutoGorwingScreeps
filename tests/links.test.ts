import { describe, expect, test } from "vitest";
import { nextLinkSlot, shouldFillStorageLink } from "../src/links/plan";
import {
  applyRcl5PlanQuotas,
  parseRcl5Plan,
  shouldPlaceRcl5Links,
} from "../src/earlyGame/rcl5Mode";

describe("rcl5Plan", () => {
  test("parse defaults to none (no link CAPEX until link_boost)", () => {
    expect(parseRcl5Plan(undefined)).toBe("none");
    expect(parseRcl5Plan("link_boost")).toBe("link_boost");
    expect(parseRcl5Plan("fat_first")).toBe("fat_first");
    expect(parseRcl5Plan("nope")).toBe("none");
  });

  test("shouldPlaceRcl5Links only for link_boost after hub with <2 links", () => {
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
        plan: "fat_first",
        rcl: 5,
        extensions: 30,
        towers: 2,
        linkCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldPlaceRcl5Links({
        plan: "link_boost",
        rcl: 5,
        extensions: 29,
        towers: 2,
        linkCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldPlaceRcl5Links({
        plan: "link_boost",
        rcl: 5,
        extensions: 30,
        towers: 2,
        linkCount: 2,
      }),
    ).toBe(false);
  });

  test("link_boost CAPEX keeps builders until both links built", () => {
    const base = {
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 3,
      builder: 0,
      filler: 1,
    };
    const during = applyRcl5PlanQuotas(base, "link_boost", {
      linksBuilt: 1,
      hasConstructionSites: true,
    });
    expect(during.upgrader).toBe(1);
    expect(during.builder).toBeGreaterThanOrEqual(2);
    const after = applyRcl5PlanQuotas(base, "link_boost", {
      linksBuilt: 2,
      hasConstructionSites: false,
    });
    expect(after).toEqual(base);
  });
});

describe("link placement priority", () => {
  test("nextLinkSlot prefers storage then controller", () => {
    expect(
      nextLinkSlot({ hasStorageLink: false, hasControllerLink: false }),
    ).toBe("storage");
    expect(
      nextLinkSlot({ hasStorageLink: true, hasControllerLink: false }),
    ).toBe("controller");
    expect(
      nextLinkSlot({ hasStorageLink: true, hasControllerLink: true }),
    ).toBeNull();
  });

  test("shouldFillStorageLink when below threshold and storage has energy", () => {
    expect(
      shouldFillStorageLink({ linkEnergy: 0, storageEnergy: 50_000 }),
    ).toBe(true);
    expect(
      shouldFillStorageLink({ linkEnergy: 500, storageEnergy: 50_000 }),
    ).toBe(false);
    expect(shouldFillStorageLink({ linkEnergy: 0, storageEnergy: 0 })).toBe(
      false,
    );
  });
});
