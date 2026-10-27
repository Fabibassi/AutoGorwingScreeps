import { describe, expect, test } from "vitest";
import {
  WALL_ARM_MIN_RCL,
  WALL_ARM_MIN_STORAGE,
  decideWallArm,
  shouldPlaceHubRamparts,
} from "../src/earlyGame/wallArm";

describe("decideWallArm", () => {
  test("off policy never arms", () => {
    const d = decideWallArm({
      rcl: 6,
      storageEnergy: 100_000,
      hostilesInRoom: 3,
      spawnDamaged: true,
      alreadyArmed: false,
      policy: "off",
    });
    expect(d.arm).toBe(false);
    expect(d.reason).toBe("policy_off");
  });

  test("force policy arms even below floors", () => {
    const d = decideWallArm({
      rcl: 3,
      storageEnergy: 0,
      hostilesInRoom: 0,
      spawnDamaged: false,
      alreadyArmed: false,
      policy: "force",
    });
    expect(d.arm).toBe(true);
    expect(d.reason).toBe("force");
  });

  test("sticky alreadyArmed stays on", () => {
    const d = decideWallArm({
      rcl: 5,
      storageEnergy: 0,
      hostilesInRoom: 0,
      spawnDamaged: false,
      alreadyArmed: true,
      policy: "auto",
    });
    expect(d.arm).toBe(true);
    expect(d.reason).toBe("sticky");
  });

  test("economy arm uses the 20k storage floor (not 50k)", () => {
    expect(WALL_ARM_MIN_STORAGE).toBe(20_000);
  });

  test("auto: economy arm at RCL+storage floors", () => {
    const no = decideWallArm({
      rcl: WALL_ARM_MIN_RCL,
      storageEnergy: WALL_ARM_MIN_STORAGE - 1,
      hostilesInRoom: 0,
      spawnDamaged: false,
      alreadyArmed: false,
      policy: "auto",
    });
    expect(no.arm).toBe(false);

    const yes = decideWallArm({
      rcl: WALL_ARM_MIN_RCL,
      storageEnergy: WALL_ARM_MIN_STORAGE,
      hostilesInRoom: 0,
      spawnDamaged: false,
      alreadyArmed: false,
      policy: "auto",
    });
    expect(yes.arm).toBe(true);
    expect(yes.reason).toBe("economy");
  });

  test("auto: raid does not arm before min RCL (RCL5 push)", () => {
    const d = decideWallArm({
      rcl: 5,
      storageEnergy: 0,
      hostilesInRoom: 1,
      spawnDamaged: true,
      alreadyArmed: false,
      policy: "auto",
    });
    expect(d.arm).toBe(false);
    expect(d.reason).toBe("wait");
  });

  test("auto: raid arm at min RCL even below storage floor", () => {
    const d = decideWallArm({
      rcl: WALL_ARM_MIN_RCL,
      storageEnergy: 0,
      hostilesInRoom: 1,
      spawnDamaged: false,
      alreadyArmed: false,
      policy: "auto",
    });
    expect(d.arm).toBe(true);
    expect(d.reason).toBe("raid");
  });

  test("raid_only: ignores economy, arms only on raid at min RCL", () => {
    const eco = decideWallArm({
      rcl: 8,
      storageEnergy: 500_000,
      hostilesInRoom: 0,
      spawnDamaged: false,
      alreadyArmed: false,
      policy: "raid_only",
    });
    expect(eco.arm).toBe(false);

    const early = decideWallArm({
      rcl: 4,
      storageEnergy: 0,
      hostilesInRoom: 2,
      alreadyArmed: false,
      spawnDamaged: false,
      policy: "raid_only",
    });
    expect(early.arm).toBe(false);

    const raid = decideWallArm({
      rcl: WALL_ARM_MIN_RCL,
      storageEnergy: 0,
      hostilesInRoom: 2,
      spawnDamaged: false,
      alreadyArmed: false,
      policy: "raid_only",
    });
    expect(raid.arm).toBe(true);
    expect(raid.reason).toBe("raid");
  });
});

describe("shouldPlaceHubRamparts", () => {
  test("only when armed", () => {
    expect(shouldPlaceHubRamparts({ wallsArmed: false })).toBe(false);
    expect(shouldPlaceHubRamparts({ wallsArmed: true })).toBe(true);
  });
});
