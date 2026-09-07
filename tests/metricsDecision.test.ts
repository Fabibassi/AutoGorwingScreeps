import { expect, test } from "vitest";
import {
  decideIssue,
  formatDecisionLog,
  parseForceAction,
} from "../ops/metricsPull";

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
    openRollbackCount: 0,
  });
  expect(d?.action).toBe("rollback");
});

test("none when rollback already open", () => {
  expect(
    decideIssue({
      stagnant: true,
      rollback: true,
      metrics,
      openEvolveCount: 0,
      openRollbackCount: 1,
    }),
  ).toBeNull();
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

test("force evolve when not stagnant", () => {
  const d = decideIssue({
    stagnant: false,
    rollback: false,
    metrics,
    openEvolveCount: 0,
    forceAction: "evolve",
  });
  expect(d?.action).toBe("evolve");
  expect(d?.title).toContain("forced");
});

test("force evolve skipped when open evolve exists", () => {
  expect(
    decideIssue({
      stagnant: false,
      rollback: false,
      metrics,
      openEvolveCount: 1,
      forceAction: "evolve",
    }),
  ).toBeNull();
});

test("force rollback when healthy", () => {
  const d = decideIssue({
    stagnant: false,
    rollback: false,
    metrics,
    openEvolveCount: 0,
    openRollbackCount: 0,
    forceAction: "rollback",
  });
  expect(d?.action).toBe("rollback");
  expect(d?.title).toContain("forced");
});

test("force rollback skipped when open rollback exists", () => {
  expect(
    decideIssue({
      stagnant: false,
      rollback: false,
      metrics,
      openEvolveCount: 0,
      openRollbackCount: 1,
      forceAction: "rollback",
    }),
  ).toBeNull();
});

test("parseForceAction defaults and rejects junk", () => {
  expect(parseForceAction(undefined)).toBe("none");
  expect(parseForceAction("evolve")).toBe("evolve");
  expect(parseForceAction("ROLLBACK")).toBe("rollback");
  expect(parseForceAction("nope")).toBe("none");
});

test("formatDecisionLog is one scannable line", () => {
  const line = formatDecisionLog({
    decision: "none",
    stagnant: false,
    windows: 1,
    rollback: false,
    openEvolve: 0,
    income: 12.5,
    forceAction: "none",
    reason: "need_4_windows",
  });
  expect(line).toBe(
    "decision=none stagnant=false windows=1 rollback=false openEvolve=0 openRollback=0 income=12.5 force=none reason=need_4_windows",
  );
});
