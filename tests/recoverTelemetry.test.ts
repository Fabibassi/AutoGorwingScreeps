import { beforeEach, describe, expect, test } from "vitest";
import { recoverTelemetryOnLoopError } from "../src/loop/recoverTelemetry";
import type { AgsMemory } from "../src/types";

describe("recoverTelemetryOnLoopError", () => {
  beforeEach(() => {
    (globalThis as { Game?: { time: number; cpu: { getUsed: () => number } } }).Game = {
      time: 100,
      cpu: { getUsed: () => 2 },
    };
  });
  test("creates fresh memory when none exists", () => {
    const result = recoverTelemetryOnLoopError(undefined);
    expect(result.metrics.errorCount).toBeGreaterThan(0);
    expect(result.errorSamples).toEqual([1]);
    expect(result.incomeSamples).toEqual([]);
  });

  test("records error against existing memory", () => {
    const existing: AgsMemory = {
      metrics: {
        tick: 10,
        rcl: 2,
        energyIncomePerTick: 5,
        errorCount: 0,
        cpuUsedAvg: 1,
        updatedAt: 10,
      },
      incomeSamples: [5],
      incomeWindows: [],
      errorSamples: [0],
      lastErrors: 0,
    };
    const result = recoverTelemetryOnLoopError(existing);
    expect(result.metrics.rcl).toBe(2);
    expect(result.lastErrors).toBe(1);
    expect(result.errorSamples.length).toBeGreaterThan(0);
  });
});
