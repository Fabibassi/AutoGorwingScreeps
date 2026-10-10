import { describe, expect, test } from "vitest";
import {
  classifyLinkRole,
  shouldTransferStorageToController,
  transferAmount,
} from "../src/links/plan";

describe("links plan", () => {
  test("classifies controller before storage when both in range", () => {
    expect(
      classifyLinkRole({
        linkPos: { x: 10, y: 10 },
        storagePos: { x: 10, y: 11 },
        controllerPos: { x: 11, y: 10 },
      }),
    ).toBe("controller");
  });

  test("classifies storage link near storage only", () => {
    expect(
      classifyLinkRole({
        linkPos: { x: 20, y: 20 },
        storagePos: { x: 21, y: 20 },
        controllerPos: { x: 40, y: 40 },
      }),
    ).toBe("storage");
  });

  test("transfer gates on cooldown, min send, and receive threshold", () => {
    expect(
      shouldTransferStorageToController({
        storageEnergy: 500,
        controllerEnergy: 100,
        storageCooldown: 0,
        controllerFree: 700,
      }),
    ).toBe(true);
    expect(
      shouldTransferStorageToController({
        storageEnergy: 500,
        controllerEnergy: 100,
        storageCooldown: 3,
        controllerFree: 700,
      }),
    ).toBe(false);
    expect(
      shouldTransferStorageToController({
        storageEnergy: 100,
        controllerEnergy: 100,
        storageCooldown: 0,
        controllerFree: 700,
      }),
    ).toBe(false);
    expect(
      shouldTransferStorageToController({
        storageEnergy: 500,
        controllerEnergy: 450,
        storageCooldown: 0,
        controllerFree: 350,
      }),
    ).toBe(false);
  });

  test("transferAmount respects free capacity", () => {
    expect(transferAmount(800, 200)).toBe(200);
    expect(transferAmount(100, 800)).toBe(100);
  });
});
