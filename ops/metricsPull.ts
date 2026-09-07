import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { AgsMemory, AgsMetrics } from "../src/types";
import {
  isStagnant,
  shouldRollback,
  STAGNATION_THRESHOLD_PCT,
} from "../src/telemetry";
import { fetchMemoryPath } from "./screepsApi";
import { resolveHostname, resolveShard, resolveToken } from "./screepsEnv";
import { countOpenIssuesWithLabel, createIssue } from "./githubIssues";

export type DecideIssueInput = {
  stagnant: boolean;
  rollback: boolean;
  metrics: AgsMetrics;
  openEvolveCount: number;
  openRollbackCount?: number;
};

export type DecideIssueResult = {
  action: "none" | "evolve" | "rollback";
  title: string;
  body: string;
};

function metricsBody(metrics: AgsMetrics): string {
  return ["## Metrics snapshot", "```json", JSON.stringify(metrics, null, 2), "```"].join(
    "\n",
  );
}

/** Pure decision helper — safe to import/test without env or network. */
export function decideIssue(
  input: DecideIssueInput,
): DecideIssueResult | null {
  if (input.rollback) {
    if ((input.openRollbackCount ?? 0) > 0) return null;
    return {
      action: "rollback",
      title: `AGS rollback: income/errors at tick ${input.metrics.tick}`,
      body: metricsBody(input.metrics),
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
 * Parse Screeps `/api/user/memory?path=ags` response.
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
  }

  throw new Error(
    `decoded memory missing AgsMemory shape: preview=${previewPayload(decoded)}`,
  );
}

export async function main(): Promise<void> {
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;
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

  const raw = await fetchMemoryPath({
    token: screepsToken,
    path: "ags",
    shard,
    hostname,
  });
  const ags = parseMemoryPathData(raw);
  if (!ags) {
    console.log("Memory.ags missing — bot not writing telemetry yet");
    return;
  }

  const stagnant = isStagnant(ags.incomeWindows, STAGNATION_THRESHOLD_PCT);
  const baselineIncome = ags.baseline?.energyIncomePerTick ?? 0;
  const rollback = shouldRollback(
    ags.metrics.energyIncomePerTick,
    baselineIncome,
    ags.metrics.errorCount,
  );

  const openEvolveCount = await countOpenIssuesWithLabel({
    token: githubToken,
    repo: githubRepo,
    label: "evolve",
  });
  const openRollbackCount = await countOpenIssuesWithLabel({
    token: githubToken,
    repo: githubRepo,
    label: "rollback",
  });

  const decision = decideIssue({
    stagnant,
    rollback,
    metrics: ags.metrics,
    openEvolveCount,
    openRollbackCount,
  });

  if (!decision) {
    console.log("no issue needed", {
      stagnant,
      rollback,
      openEvolveCount,
      openRollbackCount,
    });
    return;
  }

  await createIssue({
    token: githubToken,
    repo: githubRepo,
    title: decision.title,
    body: decision.body,
    labels: [decision.action],
  });
  console.log(`created ${decision.action} issue: ${decision.title}`);
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
