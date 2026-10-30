import { describe, expect, test, vi } from "vitest";
import {
  marketEnergyFloorsOk,
  pickMineralSellDeal,
  terminalMineralTypes,
  TERMINAL_ENERGY_FLOOR,
} from "../src/market/run";

describe("marketEnergyFloorsOk", () => {
  test("only requires terminal energy for deal costs (sell when broke)", () => {
    expect(
      marketEnergyFloorsOk({
        storageEnergy: 0,
        terminalEnergy: TERMINAL_ENERGY_FLOOR,
      }),
    ).toBe(true);
    expect(
      marketEnergyFloorsOk({
        storageEnergy: 100_000,
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
