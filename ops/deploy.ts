import { readFileSync, existsSync } from "node:fs";
import { uploadCode } from "./screepsApi";

const token = process.env.SCREEPS_TOKEN;
const branch = process.env.SCREEPS_BRANCH || "default";
const shard = process.env.SCREEPS_SHARD || undefined;

if (!token) {
  console.error("SCREEPS_TOKEN missing");
  process.exit(1);
}

const file = "dist/main.js";
if (!existsSync(file)) {
  console.error("dist/main.js missing — run npm run build");
  process.exit(1);
}

const main = readFileSync(file, "utf8");
await uploadCode({ token, branch, shard, modules: { main } });
console.log(`deployed to Screeps branch=${branch} shard=${shard ?? "(default)"}`);
