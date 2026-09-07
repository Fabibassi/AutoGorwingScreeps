import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import {
  describeMemoryResponseShape,
  parseMemoryPathData,
  planMetricsAction,
  PLACEHOLDER_METRICS,
  previewPayload,
} from "../ops/metricsPull";
import type { AgsMemory } from "../src/types";

const sampleAgs: AgsMemory = {
  metrics: {
    tick: 1000,
    rcl: 1,
    energyIncomePerTick: 10,
    errorCount: 0,
    cpuUsedAvg: 1,
    updatedAt: 1000,
  },
  incomeSamples: [10],
  incomeWindows: [10, 10],
  errorSamples: [0],
  lastErrors: 0,
};

function gzipBase64(value: unknown, withPrefix: boolean): string {
  const json = JSON.stringify(value);
  const b64 = gzipSync(Buffer.from(json, "utf8")).toString("base64");
  return withPrefix ? `gz:${b64}` : b64;
}

describe("parseMemoryPathData", () => {
  test("plain JSON string AgsMemory in envelope", () => {
    const raw = { ok: 1, data: JSON.stringify(sampleAgs) };
    expect(parseMemoryPathData(raw)).toEqual(sampleAgs);
  });

  test("envelope { ok: 1, data: \"<json>\" }", () => {
    const raw = { ok: 1, data: JSON.stringify(sampleAgs) };
    const parsed = parseMemoryPathData(raw);
    expect(parsed?.metrics.tick).toBe(1000);
    expect(parsed?.incomeWindows).toEqual([10, 10]);
  });

  test("gzip+base64 of AgsMemory JSON without gz: prefix", () => {
    const raw = { ok: 1, data: gzipBase64(sampleAgs, false) };
    expect(parseMemoryPathData(raw)).toEqual(sampleAgs);
  });

  test("gzip+base64 of AgsMemory JSON with gz: prefix", () => {
    const raw = { ok: 1, data: gzipBase64(sampleAgs, true) };
    expect(parseMemoryPathData(raw)).toEqual(sampleAgs);
  });

  test("data already a JSON object", () => {
    const raw = { ok: 1, data: sampleAgs };
    expect(parseMemoryPathData(raw)).toEqual(sampleAgs);
  });

  test("nested { ags: AgsMemory } after gzip", () => {
    const raw = { ok: 1, data: gzipBase64({ creeps: {}, ags: sampleAgs }, true) };
    expect(parseMemoryPathData(raw)).toEqual(sampleAgs);
  });

  test("missing data → null (Memory.ags not written yet)", () => {
    expect(parseMemoryPathData({ ok: 1 })).toBeNull();
    expect(parseMemoryPathData({ ok: 1, data: null })).toBeNull();
  });

  test("gzip of null → null", () => {
    const raw = { ok: 1, data: gzipBase64(null, true) };
    expect(parseMemoryPathData(raw)).toBeNull();
  });

  test("full memory without ags key → null", () => {
    const raw = { ok: 1, data: JSON.stringify({ creeps: {} }) };
    expect(parseMemoryPathData(raw)).toBeNull();
  });

  test("nested ags: null → null", () => {
    const raw = { ok: 1, data: JSON.stringify({ ags: null }) };
    expect(parseMemoryPathData(raw)).toBeNull();
  });

  test("empty string data → null", () => {
    expect(parseMemoryPathData({ ok: 1, data: "" })).toBeNull();
    expect(parseMemoryPathData({ ok: 1, data: "undefined" })).toBeNull();
  });

  test("primitive data throws clearer error with typeof + preview", () => {
    expect(() => parseMemoryPathData({ ok: 1, data: 42 })).toThrow(
      /typeof=number/,
    );
    expect(() => parseMemoryPathData({ ok: 1, data: 42 })).toThrow(/42/);
  });

  test("previewPayload truncates long strings", () => {
    const long = "x".repeat(200);
    const p = previewPayload(long, 50);
    expect(p.length).toBeLessThanOrEqual(51);
    expect(p.endsWith("…")).toBe(true);
  });

  test("describeMemoryResponseShape omits payload body", () => {
    const raw = { ok: 1, data: gzipBase64(sampleAgs, true) };
    const shape = describeMemoryResponseShape(raw);
    expect(shape).toMatch(/keys=\[data,ok\]/);
    expect(shape).toMatch(/dataType=string/);
    expect(shape).toMatch(/dataLen=\d+/);
    expect(shape).not.toContain("gz:");
    expect(shape).not.toContain("energyIncomePerTick");
  });
});

describe("planMetricsAction force with missing ags", () => {
  test("force evolve creates issue even when ags is null", () => {
    const plan = planMetricsAction({
      forceAction: "evolve",
      ags: null,
      openEvolveCount: 0,
      openRollbackCount: 0,
    });
    expect(plan.softExitReason).toBeUndefined();
    expect(plan.decision?.action).toBe("evolve");
    expect(plan.logDecision).toBe("force_evolve");
    expect(plan.reason).toBe("force_evolve");
    expect(plan.decision?.title).toContain("forced");
    expect(plan.decision?.body).toContain("missing/unreadable");
  });

  test("force rollback creates issue even when ags is null", () => {
    const plan = planMetricsAction({
      forceAction: "rollback",
      ags: null,
      openEvolveCount: 0,
      openRollbackCount: 0,
    });
    expect(plan.decision?.action).toBe("rollback");
    expect(plan.logDecision).toBe("force_rollback");
    expect(plan.reason).toBe("force_rollback");
  });

  test("force evolve skipped when open evolve exists (still no soft-exit)", () => {
    const plan = planMetricsAction({
      forceAction: "evolve",
      ags: null,
      openEvolveCount: 1,
      openRollbackCount: 0,
    });
    expect(plan.softExitReason).toBeUndefined();
    expect(plan.decision).toBeNull();
    expect(plan.logDecision).toBe("none");
    expect(plan.reason).toBe("open_evolve_exists");
  });

  test("without force, missing ags soft-exits", () => {
    const plan = planMetricsAction({
      forceAction: "none",
      ags: null,
      openEvolveCount: 0,
      openRollbackCount: 0,
    });
    expect(plan.softExitReason).toBe("missing_ags");
    expect(plan.decision).toBeNull();
    expect(plan.reason).toBe("missing_ags");
  });

  test("PLACEHOLDER_METRICS is stable for force body", () => {
    expect(PLACEHOLDER_METRICS.tick).toBe(0);
  });
});
