import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { AgsMemory, AgsMetrics } from "../src/types";
import {
  isStagnant,
  shouldRollback,
  STAGNATION_THRESHOLD_PCT,
} from "../src/telemetry";
import { fetchMemory, fetchMemoryPath } from "./screepsApi";
import { resolveHostname, resolveShard, resolveToken } from "./screepsEnv";
import { countOpenIssuesWithLabel, createIssue } from "./githubIssues";

export type ForceAction = "none" | "evolve" | "rollback";

export type DecisionLogAction =
  | "none"
  | "evolve"
  | "rollback"
  | "force_evolve"
  | "force_rollback";

export type DecideIssueInput = {
  stagnant: boolean;
  rollback: boolean;
  metrics: AgsMetrics;
  openEvolveCount: number;
  openRollbackCount?: number;
  /** Manual override from workflow_dispatch / FORCE_ACTION (default none). */
  forceAction?: ForceAction;
};

export type DecideIssueResult = {
  action: "none" | "evolve" | "rollback";
  title: string;
  body: string;
};

/** Placeholder metrics when FORCE_ACTION runs without readable Memory.ags. */
export const PLACEHOLDER_METRICS: AgsMetrics = {
  tick: 0,
  rcl: 0,
  energyIncomePerTick: 0,
  errorCount: 0,
  cpuUsedAvg: 0,
  updatedAt: 0,
};

function metricsBody(metrics: AgsMetrics, note?: string): string {
  const parts = ["## Metrics snapshot"];
  if (note) parts.push(note);
  parts.push("```json", JSON.stringify(metrics, null, 2), "```");
  return parts.join("\n");
}

/** Parse FORCE_ACTION env; invalid values → none. */
export function parseForceAction(raw: string | undefined): ForceAction {
  const v = (raw ?? "none").trim().toLowerCase();
  if (v === "evolve" || v === "rollback" || v === "none") return v;
  return "none";
}

/** Single-line decision summary for Actions logs. */
export function formatDecisionLog(opts: {
  decision: DecisionLogAction;
  stagnant: boolean;
  windows: number;
  rollback: boolean;
  openEvolve: number;
  openRollback?: number;
  income: number | string;
  forceAction?: ForceAction;
  reason?: string;
}): string {
  const parts = [
    `decision=${opts.decision}`,
    `stagnant=${opts.stagnant}`,
    `windows=${opts.windows}`,
    `rollback=${opts.rollback}`,
    `openEvolve=${opts.openEvolve}`,
    `openRollback=${opts.openRollback ?? 0}`,
    `income=${opts.income}`,
    `force=${opts.forceAction ?? "none"}`,
  ];
  if (opts.reason) parts.push(`reason=${opts.reason}`);
  return parts.join(" ");
}

/** Pure decision helper — safe to import/test without env or network. */
export function decideIssue(
  input: DecideIssueInput,
): DecideIssueResult | null {
  const force = input.forceAction ?? "none";

  if (force === "rollback" || (force === "none" && input.rollback)) {
    if ((input.openRollbackCount ?? 0) > 0) return null;
    return {
      action: "rollback",
      title:
        force === "rollback"
          ? `AGS rollback: forced at tick ${input.metrics.tick}`
          : `AGS rollback: income/errors at tick ${input.metrics.tick}`,
      body: metricsBody(input.metrics),
    };
  }

  if (force === "evolve") {
    if (input.openEvolveCount > 0) return null;
    return {
      action: "evolve",
      title: `AGS evolve: forced self-check at tick ${input.metrics.tick}`,
      body: metricsBody(
        input.metrics,
        input.metrics === PLACEHOLDER_METRICS
          ? "_Note: Memory.ags was missing/unreadable; force still opened this issue._"
          : undefined,
      ),
    };
  }

  if (input.stagnant && input.openEvolveCount === 0) {
    return {
      action: "evolve",
      title: `AGS evolve: stagnation at tick ${input.metrics.tick}`,
      body: metricsBody(input.metrics),
    };
  }
  return null;
}

/**
 * Orchestrates force-before-missing_ags soft-exit (pure; no I/O).
 * Force evolve/rollback always runs even when ags is null.
 */
export function planMetricsAction(input: {
  forceAction: ForceAction;
  ags: AgsMemory | null;
  openEvolveCount: number;
  openRollbackCount: number;
}): {
  softExitReason?: "missing_ags";
  decision: DecideIssueResult | null;
  logDecision: DecisionLogAction;
  stagnant: boolean;
  windows: number;
  rollback: boolean;
  income: number | string;
  reason?: string;
} {
  const { forceAction, ags, openEvolveCount, openRollbackCount } = input;

  if (forceAction === "evolve" || forceAction === "rollback") {
    const decision = decideIssue({
      stagnant: false,
      rollback: false,
      metrics: ags?.metrics ?? PLACEHOLDER_METRICS,
      openEvolveCount,
      openRollbackCount,
      forceAction,
    });
    let reason: string | undefined;
    if (decision) {
      reason = `force_${forceAction}`;
    } else if (forceAction === "evolve" && openEvolveCount > 0) {
      reason = "open_evolve_exists";
    } else if (forceAction === "rollback" && openRollbackCount > 0) {
      reason = "open_rollback_exists";
    }
    return {
      decision,
      logDecision: decision ? `force_${forceAction}` : "none",
      stagnant: false,
      windows: ags?.incomeWindows.length ?? 0,
      rollback: false,
      income: ags?.metrics.energyIncomePerTick ?? "n/a",
      reason,
    };
  }

  if (!ags) {
    return {
      softExitReason: "missing_ags",
      decision: null,
      logDecision: "none",
      stagnant: false,
      windows: 0,
      rollback: false,
      income: "n/a",
      reason: "missing_ags",
    };
  }

  const windows = ags.incomeWindows.length;
  const stagnant = isStagnant(ags.incomeWindows, STAGNATION_THRESHOLD_PCT);
  const baselineIncome = ags.baseline?.energyIncomePerTick ?? 0;
  const rollback = shouldRollback(
    ags.metrics.energyIncomePerTick,
    baselineIncome,
    ags.metrics.errorCount,
  );
  const income = ags.metrics.energyIncomePerTick;

  const decision = decideIssue({
    stagnant,
    rollback,
    metrics: ags.metrics,
    openEvolveCount,
    openRollbackCount,
    forceAction: "none",
  });

  let reason: string | undefined;
  if (!decision) {
    if (rollback && openRollbackCount > 0) {
      reason = "open_rollback_exists";
    } else if (!stagnant) {
      reason = windows < 4 ? "need_4_windows" : "not_stagnant";
    } else if (openEvolveCount > 0) {
      reason = "open_evolve_exists";
    }
  }

  return {
    decision,
    logDecision: decision?.action ?? "none",
    stagnant,
    windows,
    rollback,
    income,
    reason,
  };
}

const PREVIEW_MAX = 120;

/** Truncated, safe-ish preview for error messages (no full dumps). */
export function previewPayload(value: unknown, max = PREVIEW_MAX): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s == null) s = String(value);
  if (s.length > max) return `${s.slice(0, max)}…`;
  return s;
}

/**
 * Safe shape summary for Actions logs — keys/types/lengths only, no payload dump.
 */
export function describeMemoryResponseShape(raw: unknown): string {
  if (raw == null) return `raw=${String(raw)} typeof=${typeof raw}`;
  if (typeof raw !== "object") {
    return `typeof=${typeof raw} preview=${previewPayload(raw, 40)}`;
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj).sort().join(",");
  const data = obj.data;
  let dataLen: string | number = "n/a";
  if (typeof data === "string") dataLen = data.length;
  else if (data != null && typeof data === "object") {
    dataLen = Array.isArray(data)
      ? data.length
      : Object.keys(data as object).length;
  } else if (data === null) dataLen = "null";
  else if (data === undefined) dataLen = "undefined";
  return `keys=[${keys}] ok=${String(obj.ok)} dataType=${data === null ? "null" : typeof data} dataLen=${dataLen}`;
}

function looksLikeAgsMemory(value: unknown): value is AgsMemory {
  if (value == null || typeof value !== "object") return false;
  const obj = value as AgsMemory;
  return !!obj.metrics && Array.isArray(obj.incomeWindows);
}

function tryGunzipBase64Json(trimmed: string): unknown {
  const payload = trimmed.startsWith("gz:") ? trimmed.slice(3) : trimmed;
  const buf = Buffer.from(payload, "base64");
  if (buf.length === 0) {
    throw new Error("empty base64 payload");
  }
  const json = gunzipSync(buf).toString("utf8").trim();
  if (!json || json === "undefined") return null;
  return JSON.parse(json);
}

/**
 * Decode Screeps `data` field variants:
 * - already a JSON object
 * - JSON string of an object
 * - gzip+base64 (with or without `gz:` prefix)
 */
export function decodeMemoryDataField(data: unknown): unknown {
  if (data == null) return null;
  if (typeof data === "object") return data;
  if (typeof data !== "string") return data;

  const trimmed = data.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  // Screeps often returns gzip+base64 even for path queries
  try {
    return tryGunzipBase64Json(trimmed);
  } catch {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(
        `ags memory path decode failed: typeof=${typeof data} preview=${previewPayload(data)}`,
      );
    }
  }
}

/**
 * Parse Screeps `/api/user/memory?path=ags` (or full memory) response.
 * Returns `null` when Memory.ags is empty/missing (ok response, no telemetry yet).
 */
export function parseMemoryPathData(raw: unknown): AgsMemory | null {
  if (raw == null || typeof raw !== "object") {
    throw new Error(
      `memory response is not an object: typeof=${typeof raw} preview=${previewPayload(raw)}`,
    );
  }

  const envelope = raw as { data?: unknown; ok?: number; metrics?: unknown };

  // Rare: caller passed AgsMemory directly (already decoded object)
  if (looksLikeAgsMemory(envelope)) {
    return envelope;
  }

  const decoded = decodeMemoryDataField(envelope.data);

  if (decoded == null) {
    return null;
  }

  if (typeof decoded !== "object") {
    throw new Error(
      `ags memory path did not decode to an object: typeof=${typeof decoded} preview=${previewPayload(decoded)} raw=${previewPayload(raw)}`,
    );
  }

  // Path=ags returns AgsMemory directly; full memory may nest under .ags
  if (looksLikeAgsMemory(decoded)) {
    return decoded;
  }

  const nested = decoded as { ags?: unknown };
  if ("ags" in nested) {
    if (nested.ags == null) return null;
    if (looksLikeAgsMemory(nested.ags)) return nested.ags;
    if (typeof nested.ags !== "object") {
      throw new Error(
        `ags memory path did not decode to an object: typeof=${typeof nested.ags} preview=${previewPayload(nested.ags)} raw=${previewPayload(raw)}`,
      );
    }
    throw new Error(
      `decoded memory.ags missing AgsMemory shape: preview=${previewPayload(nested.ags)}`,
    );
  }

  // Full memory object without ags key → treat as missing telemetry
  return null;
}

function tryParseAgs(raw: unknown, label: string): AgsMemory | null {
  try {
    return parseMemoryPathData(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`${label} parse failed: ${msg}`);
    return null;
  }
}

/**
 * Fetch path=ags; if empty/unreadable, fall back to full memory and extract .ags.
 */
export async function fetchAndParseAgs(opts: {
  token: string;
  shard?: string;
  hostname: string;
}): Promise<{ ags: AgsMemory | null; source: "path" | "full" | "none" }> {
  const pathRaw = await fetchMemoryPath({
    token: opts.token,
    path: "ags",
    shard: opts.shard,
    hostname: opts.hostname,
  });
  console.log(`memory path=ags shape: ${describeMemoryResponseShape(pathRaw)}`);
  const fromPath = tryParseAgs(pathRaw, "path=ags");
  if (fromPath) return { ags: fromPath, source: "path" };

  const fullRaw = await fetchMemory({
    token: opts.token,
    shard: opts.shard,
    hostname: opts.hostname,
  });
  console.log(
    `memory path=(full) shape: ${describeMemoryResponseShape(fullRaw)}`,
  );
  const fromFull = tryParseAgs(fullRaw, "full memory");
  if (fromFull) return { ags: fromFull, source: "full" };

  return { ags: null, source: "none" };
}

export async function main(): Promise<void> {
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;
  const forceAction = parseForceAction(process.env.FORCE_ACTION);
  const hostname = resolveHostname();
  const shard = resolveShard();

  if (!githubToken) {
    console.error("GITHUB_TOKEN missing");
    process.exit(1);
  }
  if (!githubRepo) {
    console.error("GITHUB_REPO missing (owner/name)");
    process.exit(1);
  }

  let screepsToken: string;
  try {
    screepsToken = await resolveToken(hostname);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  console.log(
    `fetching Memory (hostname=${hostname} shard=${shard ?? "(none)"} force=${forceAction})`,
  );

  const { ags, source } = await fetchAndParseAgs({
    token: screepsToken,
    shard,
    hostname,
  });
  console.log(`ags source=${source}`);

  const needIssueCounts =
    forceAction !== "none" || ags != null;
  const openEvolveCount = needIssueCounts
    ? await countOpenIssuesWithLabel({
        token: githubToken,
        repo: githubRepo,
        label: "evolve",
      })
    : 0;
  const openRollbackCount = needIssueCounts
    ? await countOpenIssuesWithLabel({
        token: githubToken,
        repo: githubRepo,
        label: "rollback",
      })
    : 0;

  const plan = planMetricsAction({
    forceAction,
    ags,
    openEvolveCount,
    openRollbackCount,
  });

  console.log(
    formatDecisionLog({
      decision: plan.logDecision,
      stagnant: plan.stagnant,
      windows: plan.windows,
      rollback: plan.rollback,
      openEvolve: openEvolveCount,
      openRollback: openRollbackCount,
      income: plan.income,
      forceAction,
      reason: plan.reason,
    }),
  );

  if (plan.softExitReason === "missing_ags") {
    console.log("Memory.ags missing — bot not writing telemetry yet");
    return;
  }

  if (!plan.decision) {
    return;
  }

  await createIssue({
    token: githubToken,
    repo: githubRepo,
    title: plan.decision.title,
    body: plan.decision.body,
    labels: [plan.decision.action],
  });
  console.log(`created ${plan.decision.action} issue: ${plan.decision.title}`);
}

function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isExecutedAsCli()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
