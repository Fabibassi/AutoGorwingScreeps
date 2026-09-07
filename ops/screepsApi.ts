const DEFAULT_HOST = "https://screeps.com";

export function screepsHeaders(
  token: string,
  shard?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Token": token,
  };
  if (shard) headers["X-Shard"] = shard;
  return headers;
}

/** Private-server friendly auth; returns token for X-Token header. */
export async function signin(opts: {
  email: string;
  password: string;
  hostname?: string;
}): Promise<string> {
  const host = opts.hostname ?? DEFAULT_HOST;
  const res = await fetch(`${host}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: opts.email, password: opts.password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`signin failed: ${res.status} ${text}`);
  }
  const body = JSON.parse(text) as { ok?: number; token?: string; error?: string };
  if (body.ok === 0 || !body.token) {
    throw new Error(`signin API error: ${body.error ?? text}`);
  }
  return body.token;
}

export async function uploadCode(opts: {
  token: string;
  branch: string;
  modules: Record<string, string>;
  shard?: string;
  hostname?: string;
}): Promise<void> {
  const host = opts.hostname ?? DEFAULT_HOST;
  const res = await fetch(`${host}/api/user/code`, {
    method: "POST",
    headers: screepsHeaders(opts.token, opts.shard),
    body: JSON.stringify({ branch: opts.branch, modules: opts.modules }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`uploadCode failed: ${res.status} ${text}`);
  }
  try {
    const body = JSON.parse(text) as { ok?: number; error?: string };
    if (body.ok === 0) {
      throw new Error(`uploadCode API error: ${body.error ?? text}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("uploadCode")) throw e;
    // non-JSON success body — ignore
  }
}

export async function fetchMemory(opts: {
  token: string;
  shard?: string;
  hostname?: string;
}): Promise<unknown> {
  const host = opts.hostname ?? DEFAULT_HOST;
  const res = await fetch(`${host}/api/user/memory?path=`, {
    headers: screepsHeaders(opts.token, opts.shard),
  });
  if (!res.ok) {
    throw new Error(`fetchMemory failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: string; ok?: number };
  // Screeps returns gzip+base64 in data for full memory; for path queries may differ.
  // Prefer memory path API: /api/user/memory?path=ags
  return data;
}

export async function fetchMemoryPath(opts: {
  token: string;
  path: string;
  shard?: string;
  hostname?: string;
}): Promise<unknown> {
  const host = opts.hostname ?? DEFAULT_HOST;
  const url = `${host}/api/user/memory?path=${encodeURIComponent(opts.path)}`;
  const res = await fetch(url, {
    headers: screepsHeaders(opts.token, opts.shard),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`fetchMemoryPath failed: ${res.status} ${text}`);
  }
  const body = JSON.parse(text) as { ok?: number; error?: string; data?: unknown };
  if (body.ok === 0) {
    throw new Error(`fetchMemoryPath API error: ${body.error ?? text}`);
  }
  return body;
}
