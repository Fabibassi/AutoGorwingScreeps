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

test("evolve on missingSourceContainers before income rollback", () => {
  const health = {
    tick: 1000,
    rcl: 4,
    creepDeficit: 0,
    understaffed: [] as string[],
    containersAtSources: 0,
    sourceCount: 2,
    dedicatedMiners: false,
    spawnFillPct: 0.8,
    hasControllerContainer: false,
    constructionSites: 3,
    noEconomyCreeps: false,
    downgradeRisk: false,
    ticksToDowngrade: 40000,
    critical: ["incomeCollapsed", "missingSourceContainers"],
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
  expect(d?.title).toContain("missingSourceContainers");
});

test("evolve on critical noEconomyCreeps before income rollback", () => {
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
    downgradeRisk: true,
    ticksToDowngrade: 8000,
    critical: ["noEconomyCreeps", "incomeCollapsed", "downgradeRisk", "noUpgraders"],
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
  expect(d?.title).toContain("critical");
  expect(d?.body).toContain("noEconomyCreeps");
  expect(d?.body).toContain("Growth mandate");
  expect(d?.body).toContain("miner/hauler");
});

test("critical still evolves when an older evolve issue is open (reawaken)", () => {
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
        downgradeRisk: false,
        critical: ["noEconomyCreeps", "incomeCollapsed"],
      },
      openEvolveCount: 1,
      openRollbackCount: 0,
    })?.action,
  ).toBe("evolve");
});

test("downgradeRisk alone opens evolve with growth mandate", () => {
  const d = decideIssue({
    stagnant: false,
    rollback: false,
    metrics,
    health: {
      tick: 1,
      rcl: 4,
      creepDeficit: 0,
      understaffed: [],
      containersAtSources: 2,
      sourceCount: 2,
      dedicatedMiners: true,
      spawnFillPct: 0.9,
      hasControllerContainer: true,
      constructionSites: 0,
      noEconomyCreeps: false,
      downgradeRisk: true,
      ticksToDowngrade: 4000,
      critical: ["downgradeRisk"],
    },
    openEvolveCount: 0,
  });
  expect(d?.action).toBe("evolve");
  expect(d?.title).toContain("downgradeRisk");
  expect(d?.body).toContain("Growth mandate");
});

test("critical evolve still fires when an older evolve issue is already open", () => {
  const health = {
    tick: 1000,
    rcl: 4,
    creepDeficit: 0,
    understaffed: [] as string[],
    containersAtSources: 2,
    sourceCount: 2,
    dedicatedMiners: true,
    spawnFillPct: 0.2,
    hasControllerContainer: false,
    constructionSites: 0,
    noEconomyCreeps: false,
    downgradeRisk: false,
    ticksToDowngrade: 40000,
    critical: ["runtimeErrors"],
  };
  const d = decideIssue({
    stagnant: true,
    rollback: false,
    metrics,
    health,
    openEvolveCount: 1,
    openRollbackCount: 0,
  });
  expect(d?.action).toBe("evolve");
  expect(d?.title).toContain("runtimeErrors");
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
    downgradeRisk: false,
    critical: [],
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
