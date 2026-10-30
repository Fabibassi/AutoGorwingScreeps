import { describe, expect, test, vi } from "vitest";
import {
  marketEnergyFloorsOk,
  pickMineralSellDeal,
  terminalMineralTypes,
  TERMINAL_ENERGY_FLOOR,
} from "../src/market/run";
import { STORAGE_FLOOR_ENERGY } from "../src/earlyGame/storageFloor";

describe("marketEnergyFloorsOk", () => {
  test("requires storage above floor and terminal energy floor", () => {
    expect(
      marketEnergyFloorsOk({
        storageEnergy: STORAGE_FLOOR_ENERGY + 1,
        terminalEnergy: TERMINAL_ENERGY_FLOOR,
      }),
    ).toBe(true);
    expect(
      marketEnergyFloorsOk({
        storageEnergy: STORAGE_FLOOR_ENERGY,
        terminalEnergy: TERMINAL_ENERGY_FLOOR,
      }),
    ).toBe(false);
    expect(
      marketEnergyFloorsOk({
        storageEnergy: STORAGE_FLOOR_ENERGY + 1,
        terminalEnergy: TERMINAL_ENERGY_FLOOR - 1,
      }),
    ).toBe(false);
  });
});

describe("terminalMineralTypes", () => {
  test("skips energy", () => {
    vi.stubGlobal("RESOURCE_ENERGY", "energy");
    expect(
      terminalMineralTypes({ energy: 5000, H: 100, O: 0 }),
    ).toEqual(["H"]);
  });
});

describe("pickMineralSellDeal", () => {
  test("picks highest buy price", () => {
    const deal = pickMineralSellDeal({
      resource: "H" as ResourceConstant,
      amount: 200,
      orders: [
        {
          id: "low",
          type: "buy",
          resourceType: "H",
          remainingAmount: 500,
          price: 0.05,
        },
        {
          id: "high",
          type: "buy",
          resourceType: "H",
          remainingAmount: 50,
          price: 0.2,
        },
      ],
    });
    expect(deal).toEqual({ orderId: "high", amount: 50 });
  });
});
