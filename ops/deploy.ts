import { loadDistModules } from "./buildModules";
import { uploadCode } from "./screepsApi";
import { resolveHostname, resolveShard, resolveToken } from "./screepsEnv";

const branch = process.env.SCREEPS_BRANCH || "default";
const hostname = resolveHostname();
const shard = resolveShard();

const modules = loadDistModules();
if (!modules.main) {
  console.error("dist/main.js missing — run npm run build");
  process.exit(1);
}

const token = await resolveToken(hostname);
await uploadCode({ token, branch, shard, hostname, modules });
const names = Object.keys(modules).sort();
console.log(
  `deployed ${names.length} modules to ${hostname} branch=${branch} shard=${shard ?? "(none)"}: ${names.join(", ")}`,
);
