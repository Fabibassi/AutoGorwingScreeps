export type MinerHandoffSnapshot = {
  sourceId?: string;
  ticksToLive?: number;
};

export function minerMoveTicksPerTile(workParts: number, moveParts: number): number {
  const moves = Math.max(1, moveParts);
  const fatiguePerTile = Math.max(1, workParts) * 2;
  return Math.max(1, Math.ceil(fatiguePerTile / (moves * 2)));
}

export function minerReplacementLeadTime(opts: {
  bodyParts: number;
  workParts: number;
  moveParts: number;
  range: number;
  buffer?: number;
}): number {
  const spawnTicks = Math.max(0, opts.bodyParts) * 3;
  const travel =
    Math.max(0, opts.range) *
    minerMoveTicksPerTile(opts.workParts, opts.moveParts);
  return spawnTicks + travel + (opts.buffer ?? 10);
}

export function minerNeedsReplacement(
  ticksToLive: number | undefined,
  leadTime: number,
): boolean {
  if (ticksToLive == null) return false;
  return ticksToLive <= leadTime;
}

function minersOnSource(
  miners: MinerHandoffSnapshot[],
  sourceId: string,
): MinerHandoffSnapshot[] {
  return miners.filter((m) => m.sourceId === sourceId);
}

export function durableMinerCount(
  miners: MinerHandoffSnapshot[],
  sourceIds: string[],
  leadTimeFor: (sourceId: string) => number,
): number {
  let n = 0;
  for (const sid of sourceIds) {
    const here = minersOnSource(miners, sid);
    const lead = leadTimeFor(sid);
    const healthy = here.filter((m) => !minerNeedsReplacement(m.ticksToLive, lead));
    if (healthy.length > 0 || here.length >= 2) n++;
  }
  return n;
}

export function sourceIdForReplacementMiner(
  miners: MinerHandoffSnapshot[],
  sourceIds: string[],
  leadTimeFor: (sourceId: string) => number,
): string | null {
  for (const sid of sourceIds) {
    if (minersOnSource(miners, sid).length === 0) return sid;
  }
  for (const sid of sourceIds) {
    const here = minersOnSource(miners, sid);
    const lead = leadTimeFor(sid);
    const healthy = here.filter((m) => !minerNeedsReplacement(m.ticksToLive, lead));
    if (healthy.length === 0 && here.length === 1) return sid;
  }
  return null;
}

/** Replacement (higher TTL) yields the seat while the incumbent still mines. */
export function shouldWaitForIncumbentMiner(
  self: { name: string; ticksToLive?: number },
  peersNearSource: Array<{ name: string; ticksToLive?: number }>,
): boolean {
  const selfTtl = self.ticksToLive ?? 1500;
  return peersNearSource.some((p) => {
    if (p.name === self.name) return false;
    const peerTtl = p.ticksToLive ?? 0;
    return peerTtl > 0 && peerTtl < selfTtl;
  });
}
