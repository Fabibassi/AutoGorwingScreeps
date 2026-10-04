import { describe, expect, test } from "vitest";
import {
  shouldDepositInStorage,
  shouldWithdrawFromStorage,
} from "../src/roles/hauler";

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
