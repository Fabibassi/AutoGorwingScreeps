const HOUR = 60 * 60 * 1000;

export function allowAgentRun(
  timestamps: number[],
  now: number,
  maxPerHour: number,
): { ok: boolean; nextTimestamps: number[] } {
  const recent = timestamps.filter((t) => now - t < HOUR);
  if (recent.length >= maxPerHour) return { ok: false, nextTimestamps: recent };
  return { ok: true, nextTimestamps: recent.concat(now) };
}
