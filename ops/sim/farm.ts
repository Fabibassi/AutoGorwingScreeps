/**
 * Run N soft-lock sims in parallel (separate mockup ports/dirs).
 * Usage: npx tsx ops/sim/farm.ts --workers 4 --ticks 40
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv: string[]) {
  let workers = 4;
  let ticks = 40;
  let basePort = 22100;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workers" && argv[i + 1]) workers = Number(argv[++i]);
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
  }
  return { workers, ticks, basePort };
}

function runOne(instance: string, port: number, ticks: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/softLock.ts"),
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
  const { workers, ticks, basePort } = parseArgs(process.argv.slice(2));
  console.log(
    `[farm] workers=${workers} ticks=${ticks} basePort=${basePort} (machine guide: 8–16 mockup workers OK on 20-thread/64GB)`,
  );
  const jobs = Array.from({ length: workers }, (_, i) =>
    runOne(`softlock-${i}`, basePort + i, ticks),
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
