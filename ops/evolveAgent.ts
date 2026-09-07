import { Agent, CursorAgentError } from "@cursor/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { allowAgentRun } from "./rateLimit";

const stampFile = ".ags-agent-timestamps.json";

function loadStamps(): number[] {
  if (!existsSync(stampFile)) return [];
  return JSON.parse(readFileSync(stampFile, "utf8")) as number[];
}

export async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  const repoUrl = process.env.REPO_URL; // https://github.com/owner/repo
  const issueTitle = process.env.ISSUE_TITLE || "evolve";
  const issueBody = process.env.ISSUE_BODY || "";
  const issueNumber = process.env.ISSUE_NUMBER || "";

  if (!apiKey || !repoUrl) {
    console.error("CURSOR_API_KEY and REPO_URL required");
    process.exit(1);
  }

  const now = Date.now();
  const decision = allowAgentRun(loadStamps(), now, 4);
  if (!decision.ok) {
    console.error("rate limit: max 4 agent runs / hour");
    process.exit(0); // soft exit — do not fail the whole Actions minute budget angrily
  }
  writeFileSync(stampFile, JSON.stringify(decision.nextTimestamps));

  const prompt = `You are the AutoGrowingScreeps evolution agent.
Work ONLY on this GitHub issue scope. Open/update a PR with focused changes.
Issue #${issueNumber}: ${issueTitle}

${issueBody}

Constraints:
- TypeScript bot lives in src/; ops in ops/
- Keep changes small and testable; run npm test && npm run build
- Do not commit secrets
- Follow docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md
`;

  try {
    const result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: "composer-2.5" },
      cloud: {
        repos: [{ url: repoUrl, startingRef: "main" }],
        autoCreatePR: true,
        skipReviewerRequest: true,
      },
    });
    console.log(result.status, result.result);
    if (result.status === "error") process.exit(2);
  } catch (err) {
    if (err instanceof CursorAgentError) {
      console.error("startup failed", err.message, err.isRetryable);
      process.exit(1);
    }
    throw err;
  }
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
