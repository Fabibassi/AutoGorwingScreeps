import { describe, expect, test } from "vitest";
import { pastDeadline } from "../ops/sim/overnightAb";

describe("pastDeadline", () => {
  test("afternoon start is not already past 08:00", () => {
    const start = new Date(2026, 9, 6, 10, 22, 0);
    expect(pastDeadline(start, start)).toBe(false);
    expect(pastDeadline(new Date(2026, 9, 6, 11, 0, 0), start)).toBe(false);
    expect(pastDeadline(new Date(2026, 9, 7, 8, 0, 0), start)).toBe(true);
  });

  test("pre-8am start expires at 8am the same calendar day", () => {
    const start = new Date(2026, 9, 6, 0, 57, 0);
    expect(pastDeadline(new Date(2026, 9, 6, 7, 59, 0), start)).toBe(false);
    expect(pastDeadline(new Date(2026, 9, 6, 8, 0, 0), start)).toBe(true);
  });
});
