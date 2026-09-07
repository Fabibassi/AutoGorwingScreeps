import { signin } from "./screepsApi";

const DEFAULT_HOST = "https://screeps.com";

/** Normalize API base URL (no trailing slash). Empty → official World. */
export function resolveHostname(raw?: string): string {
  const h = (raw ?? process.env.SCREEPS_HOSTNAME ?? "").trim();
  if (!h) return DEFAULT_HOST;
  return h.replace(/\/+$/, "");
}

/**
 * Token from SCREEPS_TOKEN, or sign-in via SCREEPS_EMAIL + SCREEPS_PASSWORD
 * (common on private/training servers).
 */
export async function resolveToken(hostname?: string): Promise<string> {
  const token = process.env.SCREEPS_TOKEN?.trim();
  if (token) return token;

  const email = process.env.SCREEPS_EMAIL?.trim();
  const password = process.env.SCREEPS_PASSWORD;
  if (email && password) {
    return signin({
      email,
      password,
      hostname: hostname ?? resolveHostname(),
    });
  }

  throw new Error(
    "Auth missing: set SCREEPS_TOKEN or SCREEPS_EMAIL + SCREEPS_PASSWORD",
  );
}

/** Shard header only for official multi-shard World; private servers leave empty. */
export function resolveShard(): string | undefined {
  const shard = process.env.SCREEPS_SHARD?.trim();
  return shard || undefined;
}
