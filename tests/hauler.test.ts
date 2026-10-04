import { describe, expect, test } from "vitest";
import {
  shouldDepositInStorage,
  shouldWithdrawFromStorage,
} from "../src/roles/hauler";

describe("storage haul policy", () => {
  test("blocks storage deposits while income is zero", () => {
    expect(
      shouldDepositInStorage({
        energyIncomePerTick: 0,
        spawnFillPct: 1,
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
        spawnFillPct: 0.9,
        extensionsNeedingEnergy: 0,
        storageExists: true,
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
