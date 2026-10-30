/**
 * RCL7 hit build order: Ext → Tower → Spawn → Link (default).
 * Sim arms can force tower_first / spawn_first / ext_first.
 */

export type Rcl7BuildOrder = "ext_first" | "tower_first" | "spawn_first";

const ORDERS = new Set<string>(["ext_first", "tower_first", "spawn_first"]);

export function parseRcl7BuildOrder(raw: string | undefined): Rcl7BuildOrder {
  if (raw && ORDERS.has(raw)) return raw as Rcl7BuildOrder;
  return "ext_first";
}

/**
 * Which structure type to place next at RCL7+ given current counts vs quotas.
 * Returns null when quotas for Ext/Tower/Spawn/Link are satisfied.
 */
export function nextRcl7HitStructure(opts: {
  order: Rcl7BuildOrder;
  extensions: number;
  extensionQuota: number;
  towers: number;
  towerQuota: number;
  spawns: number;
  spawnQuota: number;
  links: number;
  linkQuota: number;
}): BuildableStructureConstant | null {
  const needExt = opts.extensions < opts.extensionQuota;
  const needTower = opts.towers < opts.towerQuota;
  const needSpawn = opts.spawns < opts.spawnQuota;
  const needLink = opts.links < opts.linkQuota;

  const queue: BuildableStructureConstant[] = [];
  if (opts.order === "tower_first") {
    if (needTower) queue.push(STRUCTURE_TOWER);
    if (needExt) queue.push(STRUCTURE_EXTENSION);
    if (needSpawn) queue.push(STRUCTURE_SPAWN);
  } else if (opts.order === "spawn_first") {
    if (needSpawn) queue.push(STRUCTURE_SPAWN);
    if (needExt) queue.push(STRUCTURE_EXTENSION);
    if (needTower) queue.push(STRUCTURE_TOWER);
  } else {
    // ext_first (default roadmap)
    if (needExt) queue.push(STRUCTURE_EXTENSION);
    if (needTower) queue.push(STRUCTURE_TOWER);
    if (needSpawn) queue.push(STRUCTURE_SPAWN);
  }
  if (needLink) queue.push(STRUCTURE_LINK);
  return queue[0] ?? null;
}
