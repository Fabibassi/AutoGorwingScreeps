import { describe, expect, test } from "vitest";
import {
  availableContainerEnergy,
  claimHaulOrder,
  estimateHaulTripTicks,
  settleHaulOrder,
  shouldAssignHaulOrder,
  sweepHaulOrders,
  type HaulOrderBook,
} from "../src/logistics/haulOrders";

describe("haulOrders reservation book", () => {
  test("available energy subtracts active reservations", () => {
    const book: HaulOrderBook = {
      h1: { containerId: "c1", reserved: 450, created: 10, withdrawn: 0 },
    };
    expect(availableContainerEnergy(1400, "c1", book)).toBe(950);
    expect(availableContainerEnergy(1400, "c2", book)).toBe(1400);
  });

  test("claim reserves min(freeCapacity, available)", () => {
    const book: HaulOrderBook = {};
    const order = claimHaulOrder(book, {
      haulerName: "h1",
      containerId: "c1",
      freeCapacity: 450,
      containerEnergy: 1400,
      tick: 100,
    });
    expect(order).toEqual({
      containerId: "c1",
      reserved: 450,
      created: 100,
      withdrawn: 0,
    });
    expect(book.h1.reserved).toBe(450);
    expect(availableContainerEnergy(1400, "c1", book)).toBe(950);
  });

  test("second hauler cannot claim more than leftover", () => {
    const book: HaulOrderBook = {};
    claimHaulOrder(book, {
      haulerName: "h1",
      containerId: "c1",
      freeCapacity: 450,
      containerEnergy: 500,
      tick: 1,
    });
    const second = claimHaulOrder(book, {
      haulerName: "h2",
      containerId: "c1",
      freeCapacity: 450,
      containerEnergy: 500,
      tick: 2,
    });
    expect(second?.reserved).toBe(50);
    expect(availableContainerEnergy(500, "c1", book)).toBe(0);
  });

  test("claim returns null when nothing left", () => {
    const book: HaulOrderBook = {
      h1: { containerId: "c1", reserved: 500, created: 1, withdrawn: 0 },
    };
    expect(
      claimHaulOrder(book, {
        haulerName: "h2",
        containerId: "c1",
        freeCapacity: 450,
        containerEnergy: 500,
        tick: 2,
      }),
    ).toBeNull();
  });

  test("re-claim adjusts reservation when freeCapacity shrinks", () => {
    const book: HaulOrderBook = {};
    claimHaulOrder(book, {
      haulerName: "h1",
      containerId: "c1",
      freeCapacity: 450,
      containerEnergy: 1400,
      tick: 10,
    });
    const adjusted = claimHaulOrder(book, {
      haulerName: "h1",
      containerId: "c1",
      freeCapacity: 200,
      containerEnergy: 1400,
      tick: 20,
    });
    expect(adjusted?.reserved).toBe(200);
    expect(adjusted?.created).toBe(10);
    expect(availableContainerEnergy(1400, "c1", book, "h1")).toBe(1400);
  });

  test("settle after short pickup shrinks reservation / frees leftover", () => {
    const book: HaulOrderBook = {
      h1: { containerId: "c1", reserved: 450, created: 1, withdrawn: 0 },
    };
    settleHaulOrder(book, "h1", { withdrawn: 200 });
    expect(book.h1).toBeUndefined();
    // After settle the order is gone — full store is free again.
    expect(availableContainerEnergy(1200, "c1", book)).toBe(1200);
  });

  test("settle removes order even when fully filled", () => {
    const book: HaulOrderBook = {
      h1: { containerId: "c1", reserved: 450, created: 1, withdrawn: 450 },
    };
    settleHaulOrder(book, "h1", { withdrawn: 450 });
    expect(book.h1).toBeUndefined();
  });

  test("sweep drops orders for dead haulers", () => {
    const book: HaulOrderBook = {
      dead: { containerId: "c1", reserved: 450, created: 1, withdrawn: 0 },
      alive: { containerId: "c2", reserved: 100, created: 1, withdrawn: 0 },
    };
    const dropped = sweepHaulOrders(book, {
      liveHaulerNames: new Set(["alive"]),
      tick: 50,
      maxAge: 1500,
    });
    expect(dropped).toContain("dead");
    expect(book.dead).toBeUndefined();
    expect(book.alive).toBeDefined();
  });

  test("sweep drops stale orders past maxAge", () => {
    const book: HaulOrderBook = {
      h1: { containerId: "c1", reserved: 450, created: 10, withdrawn: 0 },
    };
    sweepHaulOrders(book, {
      liveHaulerNames: new Set(["h1"]),
      tick: 2000,
      maxAge: 1500,
    });
    expect(book.h1).toBeUndefined();
  });
});

describe("haulOrders TTL gate", () => {
  test("estimates round-trip ticks from ranges", () => {
    // to container 20 + withdraw 1 + to spawn 25 + transfer 1 + margin handled by caller
    expect(estimateHaulTripTicks({ rangeToPickup: 20, rangeToDropoff: 25 })).toBe(
      20 + 25 + 2,
    );
  });

  test("rejects haulers that would die mid-trip", () => {
    expect(
      shouldAssignHaulOrder({
        ticksToLive: 40,
        tripTicks: 50,
        safetyMargin: 10,
      }),
    ).toBe(false);
    expect(
      shouldAssignHaulOrder({
        ticksToLive: 80,
        tripTicks: 50,
        safetyMargin: 10,
      }),
    ).toBe(true);
  });

  test("undefined TTL is assignable (newborn / unknown)", () => {
    expect(
      shouldAssignHaulOrder({
        ticksToLive: undefined,
        tripTicks: 50,
        safetyMargin: 10,
      }),
    ).toBe(true);
  });
});
