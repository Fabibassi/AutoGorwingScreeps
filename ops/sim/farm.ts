/**
 * Run N sims in parallel (separate mockup ports/dirs).
 * Usage:
 *   npx tsx ops/sim/farm.ts --workers 4 --ticks 40
 *   npx tsx ops/sim/farm.ts --scenario boot --workers 4
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SCENARIOS: Record<string, string> = {
  softlock: "ops/sim/softLock.ts",
  boot: "ops/sim/boot.ts",
};

function parseArgs(argv: string[]) {
  let workers = 4;
  let ticks = 40;
  let basePort = 22100;
  let scenario = "softlock";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workers" && argv[i + 1]) workers = Number(argv[++i]);
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--scenario" && argv[i + 1]) scenario = argv[++i];
  }
  return { workers, ticks, basePort, scenario };
}

function runOne(
  script: string,
  instance: string,
  port: number,
  ticks: number,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, script),
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
      ],
      {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      },
    );
    let out = "";
    child.stdout?.on("data", (b) => {
      out += String(b);
    });
    child.stderr?.on("data", (b) => {
      out += String(b);
    });
    child.on("close", (code) => {
      console.log(`\n===== ${instance} exit=${code} =====\n${out.slice(-2000)}`);
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const { workers, ticks, basePort, scenario } = parseArgs(process.argv.slice(2));
  const script = SCENARIOS[scenario];
  if (!script) {
    console.error(
      `[farm] unknown scenario=${scenario}; known: ${Object.keys(SCENARIOS).join(", ")}`,
    );
    process.exit(2);
  }
  console.log(
    `[farm] scenario=${scenario} workers=${workers} ticks=${ticks} basePort=${basePort}`,
  );
  const jobs = Array.from({ length: workers }, (_, i) =>
    runOne(script, `${scenario}-${i}`, basePort + i, ticks),
  );
  const codes = await Promise.all(jobs);
  const failed = codes.filter((c) => c !== 0).length;
  console.log(`[farm] done ok=${workers - failed} fail=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
