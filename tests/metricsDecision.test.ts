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

test("evolve on noEconomyCreeps before income rollback", () => {
  const health = {
    tick: 1000,
    rcl: 4,
    creepDeficit: 5,
    understaffed: ["harvester", "hauler", "upgrader"],
    containersAtSources: 2,
    sourceCount: 2,
    dedicatedMiners: false,
    spawnFillPct: 0.01,
    hasControllerContainer: true,
    constructionSites: 3,
    noEconomyCreeps: true,
  };
  const d = decideIssue({
    stagnant: false,
    rollback: true,
    metrics,
    health,
    openEvolveCount: 0,
    openRollbackCount: 0,
  });
  expect(d?.action).toBe("evolve");
  expect(d?.title).toContain("no economy creeps");
  expect(d?.body).toContain("noEconomyCreeps");
});

test("noEconomyCreeps skipped when evolve already open", () => {
  expect(
    decideIssue({
      stagnant: false,
      rollback: true,
      metrics,
      health: {
        tick: 1,
        rcl: 4,
        creepDeficit: 1,
        understaffed: ["harvester"],
        containersAtSources: 2,
        sourceCount: 2,
        dedicatedMiners: false,
        spawnFillPct: 0,
        hasControllerContainer: true,
        constructionSites: 0,
        noEconomyCreeps: true,
      },
      openEvolveCount: 1,
      openRollbackCount: 0,
    })?.action,
  ).toBe("rollback");
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

test("force evolve includes health snapshot when provided", () => {
  const health = {
    tick: 1000,
    rcl: 2,
    creepDeficit: 2,
    understaffed: ["harvester"],
    containersAtSources: 2,
    sourceCount: 2,
    dedicatedMiners: true,
    spawnFillPct: 0.05,
    hasControllerContainer: false,
    constructionSites: 1,
    noEconomyCreeps: false,
  };
  const d = decideIssue({
    stagnant: false,
    rollback: false,
    metrics,
    health,
    openEvolveCount: 0,
    forceAction: "evolve",
  });
  expect(d?.body).toContain("## Health check");
  expect(d?.body).toContain('"creepDeficit": 2');
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
