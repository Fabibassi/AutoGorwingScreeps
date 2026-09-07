import { readFileSync, existsSync } from "node:fs";
import { uploadCode } from "./screepsApi";
import { resolveHostname, resolveShard, resolveToken } from "./screepsEnv";

const branch = process.env.SCREEPS_BRANCH || "default";
const hostname = resolveHostname();
const shard = resolveShard();

const file = "dist/main.js";
if (!existsSync(file)) {
  console.error("dist/main.js missing — run npm run build");
  process.exit(1);
}

const token = await resolveToken(hostname);
const main = readFileSync(file, "utf8");
await uploadCode({ token, branch, shard, hostname, modules: { main } });
console.log(
  `deployed to ${hostname} branch=${branch} shard=${shard ?? "(none)"}`,
);
