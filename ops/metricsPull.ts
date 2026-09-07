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

/**
 * Parse Screeps `/api/user/memory?path=ags` response.
 * - `data` may be a JSON string of the path value
 * - or gzip+base64 (full memory style); try gunzip after base64 decode
 */
export function parseMemoryPathData(raw: unknown): AgsMemory {
  if (raw == null || typeof raw !== "object") {
    throw new Error("memory response is not an object");
  }
  const envelope = raw as { data?: unknown; ok?: number };
  let data = envelope.data;

  if (typeof data === "string") {
    const trimmed = data.trim();
    // Plain JSON string for path queries
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      data = JSON.parse(trimmed);
    } else {
      // Likely gzip+base64 (or gzip prefixed with gzip marker)
      try {
        const payload =
          trimmed.startsWith("gz:") ? trimmed.slice(3) : trimmed;
        const buf = Buffer.from(payload, "base64");
        const json = gunzipSync(buf).toString("utf8");
        data = JSON.parse(json);
      } catch {
        // Last resort: JSON.parse as-is
        data = JSON.parse(trimmed);
      }
    }
  }

  if (data == null || typeof data !== "object") {
    throw new Error("ags memory path did not decode to an object");
  }

  // Path=ags returns AgsMemory directly; full memory may nest under .ags
  const obj = data as AgsMemory & { ags?: AgsMemory };
  if (obj.metrics && Array.isArray(obj.incomeWindows)) {
    return obj as AgsMemory;
  }
  if (obj.ags && obj.ags.metrics) {
    return obj.ags;
  }
  throw new Error("decoded memory missing AgsMemory shape");
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
