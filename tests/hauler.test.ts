import { describe, expect, test } from "vitest";
import {
  minWorthwhilePickup,
  pickHaulerContainer,
  shouldDeliverNow,
  shouldDepositInStorage,
  shouldWithdrawFromStorage,
  type HaulerPickupCandidate,
  type HaulerPickupPeer,
} from "../src/roles/hauler";

describe("shouldDeliverNow", () => {
  test("waits to fill when spawn and extensions are topped up", () => {
    expect(
      shouldDeliverNow(40, 10, { spawnFillPct: 0.9, extensionsNeedingEnergy: 0 }),
    ).toBe(false);
  });

  test("delivers full loads always", () => {
    expect(
      shouldDeliverNow(50, 0, { spawnFillPct: 1, extensionsNeedingEnergy: 0 }),
    ).toBe(true);
  });

  test("delivers partial loads when spawn is hungry", () => {
    expect(
      shouldDeliverNow(18, 32, { spawnFillPct: 0.16, extensionsNeedingEnergy: 0 }),
    ).toBe(true);
  });

  test("delivers partial loads when extensions need energy", () => {
    expect(
      shouldDeliverNow(104, 46, { spawnFillPct: 0.9, extensionsNeedingEnergy: 1 }),
    ).toBe(true);
  });

  test("never delivers empty", () => {
    expect(
      shouldDeliverNow(0, 50, { spawnFillPct: 0.1, extensionsNeedingEnergy: 1 }),
    ).toBe(false);
  });
});

describe("storage haul policy", () => {
  test("allows storage overflow at zero income when spawn and extensions are full", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 0,
        spawnFillPct: 1,
        extensionsNeedingEnergy: 0,
        storageExists: true,
      }),
    ).toBe(true);
  });

  test("blocks storage deposits at zero income while spawn still needs energy", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 0,
        spawnFillPct: 0.4,
        extensionsNeedingEnergy: 0,
        storageExists: true,
      }),
    ).toBe(false);
  });

  test("blocks storage deposits while spawn is not topped up", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 5,
        spawnFillPct: 0.5,
        extensionsNeedingEnergy: 0,
        storageExists: true,
      }),
    ).toBe(false);
  });

  test("blocks storage deposits while extensions still need energy", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 5,
        spawnFillPct: 1,
        extensionsNeedingEnergy: 2,
        storageExists: true,
      }),
    ).toBe(false);
  });

  test("allows storage overflow when spawn and extensions are full", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 5,
        baselineIncome: 5,
        spawnFillPct: 0.9,
        extensionsNeedingEnergy: 0,
        storageExists: true,
      }),
    ).toBe(true);
  });

  test("blocks storage deposits when income collapsed vs baseline (RCL4 #34)", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 1.44,
        baselineIncome: 5,
        spawnFillPct: 1,
        extensionsNeedingEnergy: 0,
        storageExists: true,
      }),
    ).toBe(false);
  });

  test("withdraws from storage when income collapsed but spawn is topped up", () => {
    expect(
      shouldWithdrawFromStorage({
        energyIncomePerTick: 1.44,
        baselineIncome: 5,
        spawnFillPct: 0.95,
        extensionsNeedingEnergy: 0,
        storageExists: true,
        storageEnergy: 2000,
      }),
    ).toBe(true);
  });

  test("prefers storage withdrawal when spawn is low during income stall", () => {
    expect(
      shouldWithdrawFromStorage({
        energyIncomePerTick: 0,
        spawnFillPct: 0.2,
        extensionsNeedingEnergy: 0,
        storageExists: true,
        storageEnergy: 500,
      }),
    ).toBe(true);
  });

  test("does not withdraw from empty storage", () => {
    expect(
      shouldWithdrawFromStorage({
        energyIncomePerTick: 0,
        spawnFillPct: 0.1,
        extensionsNeedingEnergy: 0,
        storageExists: true,
        storageEnergy: 0,
      }),
    ).toBe(false);
  });
});

describe("hauler pickup selection", () => {
  test("ignores crumb containers when free capacity is large", () => {
    // 450 free, spawn healthy → need a meaningful pile, not <100.
    expect(minWorthwhilePickup(450, 0.9)).toBeGreaterThanOrEqual(100);
    expect(minWorthwhilePickup(450, 0.9)).toBeLessThanOrEqual(450);
  });

  test("accepts smaller piles when spawn is starving", () => {
    expect(minWorthwhilePickup(450, 0.2)).toBeLessThanOrEqual(50);
  });

  test("two haulers split across two rich containers", () => {
    const containers: HaulerPickupCandidate[] = [
      { id: "cA", energy: 800, range: 10 },
      { id: "cB", energy: 700, range: 12 },
    ];
    // No sticky targets yet — claim in id order so both creeps agree.
    const peers: HaulerPickupPeer[] = [
      { id: "h1", freeCapacity: 450 },
      { id: "h2", freeCapacity: 450 },
    ];
    const pickA = pickHaulerContainer({
      haulerId: "h1",
      freeCapacity: 450,
      spawnFillPct: 0.9,
      containers,
      peers,
    });
    const pickB = pickHaulerContainer({
      haulerId: "h2",
      freeCapacity: 450,
      spawnFillPct: 0.9,
      containers,
      peers,
    });
    expect(pickA).toBe("cA");
    expect(pickB).toBe("cB");
    expect(pickA).not.toBe(pickB);
  });

  test("skips thin container when a richer one exists", () => {
    const containers: HaulerPickupCandidate[] = [
      { id: "thin", energy: 80, range: 5 },
      { id: "fat", energy: 900, range: 20 },
    ];
    const pick = pickHaulerContainer({
      haulerId: "h1",
      freeCapacity: 450,
      spawnFillPct: 0.9,
      containers,
      peers: [],
    });
    expect(pick).toBe("fat");
  });

  test("falls back to best available when all piles are thin", () => {
    const containers: HaulerPickupCandidate[] = [
      { id: "a", energy: 40, range: 8 },
      { id: "b", energy: 90, range: 10 },
    ];
    const pick = pickHaulerContainer({
      haulerId: "h1",
      freeCapacity: 450,
      spawnFillPct: 0.9,
      containers,
      peers: [],
    });
    expect(pick).toBe("b");
  });
});
