import { describe, expect, test, vi } from "vitest";
import { ROLE_ICONS, shouldShowCreepJobs, showCreepJob } from "../src/visuals";

describe("showCreepJob", () => {
  test("shows visual-only icon for known role", () => {
    const say = vi.fn();
    const creep = {
      memory: { role: "harvester" },
      say,
    } as unknown as Creep;

    showCreepJob(creep);

    expect(say).toHaveBeenCalledWith(ROLE_ICONS.harvester, true);
  });

  test("does nothing for unknown role", () => {
    const say = vi.fn();
    const creep = {
      memory: { role: "scout" },
      say,
    } as unknown as Creep;

    showCreepJob(creep);

    expect(say).not.toHaveBeenCalled();
  });

  test("does nothing when role is missing", () => {
    const say = vi.fn();
    const creep = { memory: {}, say } as unknown as Creep;

    showCreepJob(creep);

    expect(say).not.toHaveBeenCalled();
  });
});

describe("shouldShowCreepJobs", () => {
  test("hides icons when the CPU bucket is starved", () => {
    expect(shouldShowCreepJobs(1999)).toBe(false);
    expect(shouldShowCreepJobs(2000)).toBe(true);
  });
});

describe("ROLE_ICONS", () => {
  test("defines icons for all registered roles", () => {
    expect(ROLE_ICONS.harvester).toBeTruthy();
    expect(ROLE_ICONS.upgrader).toBeTruthy();
  });
});
