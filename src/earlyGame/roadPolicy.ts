/**
 * Road-build timing strategies for A/B sims (controller↔sources / spawn paths).
 */
export const ROAD_POLICIES = [
  "after_containers",
  "parallel",
  "after_rcl3",
  "source_first",
] as const;

export type RoadPolicy = (typeof ROAD_POLICIES)[number];

export function parseRoadPolicy(raw: string | undefined): RoadPolicy {
  if (raw && (ROAD_POLICIES as readonly string[]).includes(raw)) {
    return raw as RoadPolicy;
  }
  // Experiment winner: roads in parallel with containers (source paths first).
  return "parallel";
}

/** Min RCL before any roads for this policy. */
export function roadMinRcl(policy: RoadPolicy): number {
  if (policy === "after_rcl3") return 3;
  return 2;
}

/**
 * Whether unfinished source containers block road placement.
 * - after_containers / after_rcl3: yes (containers first)
 * - parallel / source_first: no (roads may start while containers build)
 */
export function roadsBlockedByContainers(policy: RoadPolicy): boolean {
  return policy === "after_containers" || policy === "after_rcl3";
}

/** Prefer spawn→source / controller→source before spawn→controller. */
export function preferSourceRoads(policy: RoadPolicy): boolean {
  return policy === "source_first" || policy === "parallel";
}

/** Place road sites even while source-container sites still exist. */
export function roadsWhileContainersMissing(policy: RoadPolicy): boolean {
  return policy === "parallel" || policy === "source_first";
}
