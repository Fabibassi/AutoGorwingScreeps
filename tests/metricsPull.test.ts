import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import {
  parseMemoryPathData,
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

  test("nested ags missing → null", () => {
    const raw = { ok: 1, data: JSON.stringify({ creeps: {} }) };
    // full memory without ags key — not AgsMemory shape
    expect(() => parseMemoryPathData(raw)).toThrow(/missing AgsMemory shape/);
  });

  test("nested ags: null → null", () => {
    const raw = { ok: 1, data: JSON.stringify({ ags: null }) };
    expect(parseMemoryPathData(raw)).toBeNull();
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
});
