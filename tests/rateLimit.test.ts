import { expect, test } from "vitest";
import { allowAgentRun } from "../ops/rateLimit";

test("allows under cap", () => {
  const now = 1_000_000;
  const r = allowAgentRun([now - 1000], now, 4);
  expect(r.ok).toBe(true);
  expect(r.nextTimestamps).toHaveLength(2);
});

test("blocks at 4 in last hour", () => {
  const now = 3_600_000;
  const stamps = [1, 2, 3, 4].map((i) => now - i * 1000);
  expect(allowAgentRun(stamps, now, 4).ok).toBe(false);
});
