import { describe, expect, test } from "vitest";
import { decideIssue } from "../ops/metricsPull";

const metrics = {
  tick: 1000,
  rcl: 1,
  energyIncomePerTick: 10,
  errorCount: 0,
  cpuUsedAvg: 1,
  updatedAt: 1000,
};

test("rollback wins over evolve", () => {
  const d = decideIssue({
    stagnant: true,
    rollback: true,
    metrics,
    openEvolveCount: 0,
  });
  expect(d?.action).toBe("rollback");
});

test("evolve when stagnant and no open evolve issues", () => {
  const d = decideIssue({
    stagnant: true,
    rollback: false,
    metrics,
    openEvolveCount: 0,
  });
  expect(d?.action).toBe("evolve");
});

test("none when stagnant but evolve already open", () => {
  const d = decideIssue({
    stagnant: true,
    rollback: false,
    metrics,
    openEvolveCount: 1,
  });
  expect(d).toBeNull();
});

test("none when healthy", () => {
  expect(
    decideIssue({
      stagnant: false,
      rollback: false,
      metrics,
      openEvolveCount: 0,
    }),
  ).toBeNull();
});
