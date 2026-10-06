import { describe, expect, test } from "vitest";
import {
  HAUL_THRESHOLDS,
  minWorthwhilePickup,
  pickHaulerContainer,
  shouldDeliverNow,
  shouldDepositInStorage,
  shouldWithdrawFromStorage,
  type HaulerPickupCandidate,
  type HaulerPickupPeer,
} from "../src/roles/hauler";

describe("shouldDeliverNow", () => {
  test("waits to fill when spawn is comfortable and extensions are full", () => {
    expect(
      shouldDeliverNow(40, 10, {
        spawnEnergy: 280,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
      }),
    ).toBe(false);
  });

  test("delivers full loads always", () => {
    expect(
      shouldDeliverNow(50, 0, {
        spawnEnergy: 300,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
      }),
    ).toBe(true);
  });

  test("delivers any partial when spawn is urgent (<150)", () => {
    expect(
      shouldDeliverNow(18, 32, {
        spawnEnergy: 48,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
      }),
    ).toBe(true);
  });

  test("hungry spawn only turns around with a meaningful partial load", () => {
    expect(
      shouldDeliverNow(40, 410, {
        spawnEnergy: 200,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
      }),
    ).toBe(false);
    expect(
      shouldDeliverNow(120, 330, {
        spawnEnergy: 200,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
      }),
    ).toBe(true);
  });

  test("extension need alone does not U-turn a nearly empty hauler", () => {
    expect(
      shouldDeliverNow(40, 410, {
        spawnEnergy: 280,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 3,
      }),
    ).toBe(false);
    expect(
      shouldDeliverNow(280, 170, {
        spawnEnergy: 280,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 3,
      }),
    ).toBe(true);
  });

  test("never delivers empty", () => {
    expect(
      shouldDeliverNow(0, 50, {
        spawnEnergy: 30,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 1,
      }),
    ).toBe(false);
  });
});

describe("storage haul policy (absolute spawn energy)", () => {
  test("allows storage overflow when spawn is comfortable and extensions full", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 0,
        spawnEnergy: 300,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
        storageExists: true,
      }),
    ).toBe(true);
  });

  test("blocks storage deposits while spawn still needs absolute energy", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 0,
        spawnEnergy: 120,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
        storageExists: true,
      }),
    ).toBe(false);
  });

  test("blocks storage deposits while extensions still need energy", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 5,
        spawnEnergy: 300,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 2,
        storageExists: true,
      }),
    ).toBe(false);
  });

  test("allows storage overflow when spawn comfortable and income healthy", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 5,
        baselineIncome: 5,
        spawnEnergy: 270,
        spawnCapacity: 300,
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
        spawnEnergy: 300,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
        storageExists: true,
      }),
    ).toBe(false);
  });

  test("withdraws from storage when spawn is not comfortable", () => {
    expect(
      shouldWithdrawFromStorage({
        energyIncomePerTick: 5,
        spawnEnergy: 180,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
        storageExists: true,
        storageEnergy: 2000,
      }),
    ).toBe(true);
  });

  test("withdraws from storage when income stalled even if spawn full", () => {
    expect(
      shouldWithdrawFromStorage({
        energyIncomePerTick: 1.44,
        baselineIncome: 5,
        spawnEnergy: 290,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
        storageExists: true,
        storageEnergy: 2000,
      }),
    ).toBe(true);
  });

  test("does not withdraw from empty storage", () => {
    expect(
      shouldWithdrawFromStorage({
        energyIncomePerTick: 0,
        spawnEnergy: 30,
        spawnCapacity: 300,
        extensionsNeedingEnergy: 0,
        storageExists: true,
        storageEnergy: 0,
      }),
    ).toBe(false);
  });

  test("thresholds are absolute spawn units not storage percents", () => {
    expect(HAUL_THRESHOLDS.spawnUrgent).toBe(150);
    expect(HAUL_THRESHOLDS.spawnComfortable).toBe(250);
    // Sanity: comfortable is far below any storage-% interpretation of 1M.
    expect(HAUL_THRESHOLDS.spawnComfortable).toBeLessThan(1000);
  });
});

describe("hauler pickup selection", () => {
  test("ignores crumb containers when free capacity is large", () => {
    expect(minWorthwhilePickup(450, 280)).toBeGreaterThanOrEqual(100);
    expect(minWorthwhilePickup(450, 280)).toBeLessThanOrEqual(450);
  });

  test("accepts smaller piles when spawn is urgent", () => {
    expect(minWorthwhilePickup(450, 100)).toBeLessThanOrEqual(50);
  });

  test("two haulers split across two rich containers", () => {
    const containers: HaulerPickupCandidate[] = [
      { id: "cA", energy: 800, range: 10 },
      { id: "cB", energy: 700, range: 12 },
    ];
    const peers: HaulerPickupPeer[] = [
      { id: "h1", freeCapacity: 450 },
      { id: "h2", freeCapacity: 450 },
    ];
    const pickA = pickHaulerContainer({
      haulerId: "h1",
      freeCapacity: 450,
      spawnEnergy: 280,
      containers,
      peers,
    });
    const pickB = pickHaulerContainer({
      haulerId: "h2",
      freeCapacity: 450,
      spawnEnergy: 280,
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
      spawnEnergy: 280,
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
      spawnEnergy: 280,
      containers,
      peers: [],
    });
    expect(pick).toBe("b");
  });
});
