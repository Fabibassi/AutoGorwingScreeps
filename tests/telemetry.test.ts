import { describe, expect, test } from "vitest";
import {
  average,
  isIncomeStalled,
  isStagnant,
  recordEnergySample,
  shouldRollback,
} from "../src/telemetry";

describe("recordEnergySample", () => {
  test("appends and trims to max", () => {
    const next = recordEnergySample([1, 2, 3], 4, 3);
    expect(next).toEqual([2, 3, 4]);
  });
});

describe("average", () => {
  test("returns 0 for empty", () => {
    expect(average([])).toBe(0);
  });
  test("averages numbers", () => {
    expect(average([2, 4, 6])).toBe(4);
  });
});

describe("isStagnant", () => {
  test("true when four windows within 5%", () => {
    expect(isStagnant([100, 101, 99, 100], 0.05)).toBe(true);
  });
  test("false when swing exceeds 5%", () => {
    expect(isStagnant([100, 120, 100, 100], 0.05)).toBe(false);
  });
  test("false when fewer than 4 windows", () => {
    expect(isStagnant([100, 100, 100], 0.05)).toBe(false);
  });
});

describe("isIncomeStalled", () => {
  test("true at zero income", () => {
    expect(isIncomeStalled(0, 10)).toBe(true);
  });
  test("true at rollback threshold vs baseline", () => {
    expect(isIncomeStalled(1.44, 5)).toBe(true);
  });
  test("false when healthy or baseline missing", () => {
    expect(isIncomeStalled(4, 5)).toBe(false);
    expect(isIncomeStalled(0.1, undefined)).toBe(false);
  });
});

describe("shouldRollback", () => {
  test("true on 30%+ income drop", () => {
    expect(shouldRollback(69, 100, 0)).toBe(true);
  });
  test("true on error spike", () => {
    expect(shouldRollback(100, 100, 10)).toBe(true);
  });
  test("false when healthy", () => {
    expect(shouldRollback(95, 100, 2)).toBe(false);
  });
});
