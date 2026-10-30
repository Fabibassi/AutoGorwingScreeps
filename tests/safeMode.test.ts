import { describe, expect, test } from "vitest";
import { shouldActivateSafeMode } from "../src/defense/safeMode";

describe("shouldActivateSafeMode", () => {
  test("activates on spawn damage when available", () => {
    expect(
      shouldActivateSafeMode({
        safeModeAvailable: 1,
        safeModeCooldown: 0,
        spawnDamaged: true,
        hostileCount: 0,
      }),
    ).toBe(true);
  });

  test("activates on mass hostiles", () => {
    expect(
      shouldActivateSafeMode({
        safeModeAvailable: 1,
        safeModeCooldown: 0,
        spawnDamaged: false,
        hostileCount: 3,
      }),
    ).toBe(true);
  });

  test("skips when unavailable or on cooldown", () => {
    expect(
      shouldActivateSafeMode({
        safeModeAvailable: 0,
        safeModeCooldown: 0,
        spawnDamaged: true,
        hostileCount: 5,
      }),
    ).toBe(false);
    expect(
      shouldActivateSafeMode({
        safeModeAvailable: 1,
        safeModeCooldown: 100,
        spawnDamaged: true,
        hostileCount: 5,
      }),
    ).toBe(false);
  });

  test("ignores single scout", () => {
    expect(
      shouldActivateSafeMode({
        safeModeAvailable: 1,
        safeModeCooldown: 0,
        spawnDamaged: false,
        hostileCount: 1,
      }),
    ).toBe(false);
  });
});
