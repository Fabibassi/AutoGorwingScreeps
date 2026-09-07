import { describe, expect, test } from "vitest";
import {
  formatStatusLine,
  getPlanPriority,
  STATUS_LOG_INTERVAL,
} from "../src/statusLog";

describe("getPlanPriority", () => {
  test("harvester deficit → spawn:harvester", () => {
    expect(getPlanPriority(1, { harvester: 1, upgrader: 1 }, false)).toBe(
      "spawn:harvester",
    );
  });

  test("harvesters full, upgrader deficit → spawn:upgrader", () => {
    expect(getPlanPriority(1, { harvester: 3, upgrader: 0 }, false)).toBe(
      "spawn:upgrader",
    );
  });

  test("spawn busy overrides deficit", () => {
    expect(getPlanPriority(1, { harvester: 0, upgrader: 0 }, true)).toBe(
      "spawn:busy",
    );
  });

  test("creeps satisfied → harvest+upgrade", () => {
    expect(getPlanPriority(1, { harvester: 3, upgrader: 1 }, false)).toBe(
      "harvest+upgrade",
    );
  });
});

describe("formatStatusLine", () => {
  test("compact one-line summary", () => {
    const line = formatStatusLine({
      tick: 100,
      rcl: 2,
      energy: { spawn: 150, creeps: 80 },
      counts: { harvester: 3, upgrader: 1 },
      priority: "spawn:upgrader",
    });
    expect(line).toBe(
      "[t100] RCL2 | energy spawn=150 creeps=80 | H=3 U=1 | plan=spawn:upgrader",
    );
  });
});

describe("STATUS_LOG_INTERVAL", () => {
  test("defaults to 20 ticks", () => {
    expect(STATUS_LOG_INTERVAL).toBe(20);
  });
});
