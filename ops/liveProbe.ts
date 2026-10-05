/**
 * One-shot Screeps live status for ops (Memory.ags + creeps + room objects).
 * Usage: SCREEPS_TOKEN=... SCREEPS_SHARD=shard3 npx tsx ops/liveProbe.ts [ROOM]
 */
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fetchMemoryPath, screepsHeaders } from "./screepsApi";
import { resolveHostname, resolveShard, resolveToken } from "./screepsEnv";

const DEFAULT_ROOM = "W21N35";

function decodeDataField(data: unknown): unknown {
  if (data == null) return null;
  if (typeof data === "object") return data;
  if (typeof data !== "string") return data;
  const trimmed = data.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  const payload = trimmed.startsWith("gz:") ? trimmed.slice(3) : trimmed;
  const json = gunzipSync(Buffer.from(payload, "base64")).toString("utf8");
  return JSON.parse(json);
}

async function fetchPath(
  token: string,
  path: string,
  shard: string | undefined,
  hostname: string,
): Promise<unknown> {
  const raw = await fetchMemoryPath({ token, path, shard, hostname });
  const envelope = raw as { data?: unknown };
  return decodeDataField(envelope.data);
}

async function fetchRoomObjects(opts: {
  token: string;
  room: string;
  shard?: string;
  hostname: string;
}): Promise<unknown[]> {
  const host = opts.hostname.replace(/\/+$/, "");
  const u = new URL(`${host}/api/game/room-objects`);
  u.searchParams.set("room", opts.room);
  if (opts.shard) u.searchParams.set("shard", opts.shard);
  const res = await fetch(u.toString(), {
    headers: screepsHeaders(opts.token, opts.shard),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`room-objects failed: ${res.status} ${text}`);
  const body = JSON.parse(text) as { ok?: number; objects?: unknown[]; error?: string };
  if (body.ok === 0) throw new Error(`room-objects API error: ${body.error ?? text}`);
  return body.objects ?? [];
}

function countRoles(creepsMem: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (creepsMem == null || typeof creepsMem !== "object") return counts;
  for (const name of Object.keys(creepsMem as object)) {
    const m = (creepsMem as Record<string, { role?: string }>)[name];
    const role = m?.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

function energyFrom(o: Record<string, unknown>): number {
  if (typeof o.store === "object" && o.store) {
    return (o.store as Record<string, number>).energy ?? 0;
  }
  return typeof o.energy === "number" ? o.energy : 0;
}

function summarizeObjects(objects: unknown[]): {
  creeps: Record<string, number>;
  creepDetails: Array<{
    name: string;
    role: string;
    body: string[];
    storeEnergy: number;
    hasCarry: boolean;
    hasWork: boolean;
  }>;
  myCreeps: number;
  spawns: Array<{ name?: string; energy?: number; energyCapacity?: number; x?: number; y?: number }>;
  sources: number;
  controller?: {
    level?: number;
    progress?: number;
    progressTotal?: number;
    ticksToDowngrade?: number;
  };
  constructionSites: number;
  sites: Array<{ structureType: string; progress: number; progressTotal: number; x: number; y: number }>;
  extensionCount: number;
  extensionEnergy: number;
  storageEnergy: number;
  containerEnergy: number;
  droppedEnergy: number;
  approxEnergyAvailable: number;
  /** Largest energy piles with distance to first spawn (soft-lock triage). */
  topDrops: Array<{ amount: number; x: number; y: number; distToSpawn: number | null }>;
  energyNearSpawn: number;
  /** Adjacent spawn tiles free for newborn creeps (max 8). */
  freeSpawnExits: number;
  spawnAdjacentBlocked: Array<{ x: number; y: number; by: string }>;
} {
  const creeps: Record<string, number> = {};
  const creepDetails: Array<{
    name: string;
    role: string;
    body: string[];
    storeEnergy: number;
    hasCarry: boolean;
    hasWork: boolean;
  }> = [];
  let myCreeps = 0;
  const spawns: Array<{ name?: string; energy?: number; energyCapacity?: number; x?: number; y?: number }> =
    [];
  let sources = 0;
  let constructionSites = 0;
  const sites: Array<{ structureType: string; progress: number; progressTotal: number; x: number; y: number }> = [];
  let extensionCount = 0;
  let extensionEnergy = 0;
  let storageEnergy = 0;
  let containerEnergy = 0;
  let droppedEnergy = 0;
  let spawnEnergy = 0;
  const dropPiles: Array<{ amount: number; x: number; y: number }> = [];
  let controller:
    | {
        level?: number;
        progress?: number;
        progressTotal?: number;
        ticksToDowngrade?: number;
      }
    | undefined;

  for (const raw of objects) {
    if (raw == null || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const type = String(o.type ?? "");
    if (type === "creep") {
      myCreeps++;
      // room-objects often omit memory.role; count by name prefix as fallback
      const name = String(o.name ?? "");
      const role = name.split("-")[0] || "creep";
      creeps[role] = (creeps[role] ?? 0) + 1;
      const body = Array.isArray(o.body)
        ? (o.body as Array<{ type?: string } | string>).map((p) =>
            typeof p === "string" ? p : String(p?.type ?? "?"),
          )
        : [];
      const storeEnergy =
        typeof o.store === "object" && o.store
          ? ((o.store as Record<string, number>).energy ?? 0)
          : typeof o.energy === "number"
            ? o.energy
            : 0;
      creepDetails.push({
        name,
        role,
        body,
        storeEnergy,
        hasCarry: body.includes("carry"),
        hasWork: body.includes("work"),
      });
    } else if (type === "spawn") {
      const energy = energyFrom(o);
      spawnEnergy += energy;
      spawns.push({
        name: typeof o.name === "string" ? o.name : undefined,
        energy,
        energyCapacity:
          typeof o.storeCapacityResource === "object" && o.storeCapacityResource
            ? (o.storeCapacityResource as Record<string, number>).energy
            : (o as { energyCapacity?: number }).energyCapacity,
        x: typeof o.x === "number" ? o.x : undefined,
        y: typeof o.y === "number" ? o.y : undefined,
      });
    } else if (type === "extension") {
      extensionCount++;
      extensionEnergy += energyFrom(o);
    } else if (type === "storage") {
      storageEnergy += energyFrom(o);
    } else if (type === "container") {
      containerEnergy += energyFrom(o);
    } else if (type === "energy" || type === "tombstone" || type === "ruin") {
      let amt = energyFrom(o);
      if (typeof o.resourceType === "string" && o.resourceType === "energy") {
        amt += typeof o.amount === "number" ? o.amount : 0;
      }
      if (typeof o.amount === "number" && type === "energy") {
        amt = Math.max(amt, o.amount);
      }
      droppedEnergy += amt;
      if (amt > 0 && typeof o.x === "number" && typeof o.y === "number") {
        dropPiles.push({ amount: amt, x: o.x, y: o.y });
      }
    } else if (type === "source") {
      sources++;
    } else if (type === "controller") {
      controller = {
        level: o.level as number | undefined,
        progress: o.progress as number | undefined,
        progressTotal: o.progressTotal as number | undefined,
        ticksToDowngrade: o.ticksToDowngrade as number | undefined,
      };
    } else if (type === "constructionSite") {
      constructionSites++;
      sites.push({
        structureType: String(o.structureType ?? "?"),
        progress: typeof o.progress === "number" ? o.progress : 0,
        progressTotal: typeof o.progressTotal === "number" ? o.progressTotal : 0,
        x: typeof o.x === "number" ? o.x : -1,
        y: typeof o.y === "number" ? o.y : -1,
      });
    }
  }

  const spawnPos = spawns.find((s) => s.x != null && s.y != null);
  const withDist = dropPiles.map((d) => ({
    ...d,
    distToSpawn:
      spawnPos?.x != null && spawnPos.y != null
        ? Math.max(Math.abs(d.x - spawnPos.x), Math.abs(d.y - spawnPos.y))
        : null,
  }));
  withDist.sort((a, b) => b.amount - a.amount);
  const energyNearSpawn = withDist
    .filter((d) => d.distToSpawn != null && d.distToSpawn <= 2)
    .reduce((s, d) => s + d.amount, 0);

  const BLOCKING = new Set([
    "spawn",
    "extension",
    "storage",
    "tower",
    "link",
    "lab",
    "terminal",
    "factory",
    "nuker",
    "observer",
    "powerSpawn",
    "wall",
    "rampart",
    "constructedWall",
  ]);
  const spawnAdjacentBlocked: Array<{ x: number; y: number; by: string }> = [];
  let freeSpawnExits = 0;
  if (spawnPos?.x != null && spawnPos.y != null) {
    const sx = spawnPos.x;
    const sy = spawnPos.y;
    const deltas = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (const [dx, dy] of deltas) {
      const x = sx + dx;
      const y = sy + dy;
      const blockers = objects.filter((raw) => {
        if (raw == null || typeof raw !== "object") return false;
        const o = raw as Record<string, unknown>;
        if (o.x !== x || o.y !== y) return false;
        const t = String(o.type ?? "");
        if (t === "constructionSite") {
          const st = String(o.structureType ?? "");
          return st !== "road" && st !== "container";
        }
        return BLOCKING.has(t);
      });
      if (blockers.length === 0) {
        freeSpawnExits++;
      } else {
        const o = blockers[0] as Record<string, unknown>;
        spawnAdjacentBlocked.push({
          x,
          y,
          by:
            o.type === "constructionSite"
              ? `site:${String(o.structureType)}`
              : String(o.type),
        });
      }
    }
  }

  return {
    creeps,
    creepDetails,
    myCreeps,
    spawns,
    sources,
    controller,
    constructionSites,
    sites,
    extensionCount,
    extensionEnergy,
    storageEnergy,
    containerEnergy,
    droppedEnergy,
    approxEnergyAvailable: spawnEnergy + extensionEnergy,
    topDrops: withDist.slice(0, 8),
    energyNearSpawn,
    freeSpawnExits,
    spawnAdjacentBlocked,
  };
}

export async function main(): Promise<void> {
  const room = (process.argv[2] ?? process.env.SCREEPS_ROOM ?? DEFAULT_ROOM).trim();
  const hostname = resolveHostname();
  const shard = resolveShard();
  const token = await resolveToken(hostname);

  console.log(`probe room=${room} host=${hostname} shard=${shard ?? "(none)"}`);

  const ags = await fetchPath(token, "ags", shard, hostname);
  console.log("## Memory.ags");
  console.log(JSON.stringify(ags, null, 2));

  const creepsMem = await fetchPath(token, "creeps", shard, hostname);
  const memRoles = countRoles(creepsMem);
  console.log("## Memory.creeps roles");
  console.log(JSON.stringify(memRoles, null, 2));
  console.log(`creepNames=${Object.keys((creepsMem as object) ?? {}).length}`);

  const objects = await fetchRoomObjects({ token, room, shard, hostname });
  const summary = summarizeObjects(objects);
  console.log("## Room objects summary");
  console.log(JSON.stringify(summary, null, 2));
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
