const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

function authHeaders(token: string): HeadersInit {
  return {
    ...GH_HEADERS,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Create an issue without labels, then add labels in a second request so
 * GitHub always emits `issues.labeled` (creating with labels in one POST may
 * only fire `opened`, which Evolve no longer listens to).
 */
export async function createIssue(opts: {
  token: string;
  repo: string; // owner/name
  title: string;
  body: string;
  labels: string[];
}): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${opts.repo}/issues`, {
    method: "POST",
    headers: authHeaders(opts.token),
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
    }),
  });
  if (!res.ok) {
    throw new Error(`createIssue failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { number: number };
  const issueNumber = data.number;

  if (opts.labels.length > 0) {
    const labelRes = await fetch(
      `https://api.github.com/repos/${opts.repo}/issues/${issueNumber}/labels`,
      {
        method: "POST",
        headers: authHeaders(opts.token),
        body: JSON.stringify({ labels: opts.labels }),
      },
    );
    if (!labelRes.ok) {
      throw new Error(
        `addIssueLabels failed: ${labelRes.status} ${await labelRes.text()}`,
      );
    }
  }

  return issueNumber;
}

/** Trigger Evolve via workflow_dispatch so Metrics does not rely only on labeled. */
export async function dispatchEvolveWorkflow(opts: {
  token: string;
  repo: string;
  issueNumber: number;
  ref?: string;
}): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${opts.repo}/actions/workflows/evolve.yml/dispatches`,
    {
      method: "POST",
      headers: authHeaders(opts.token),
      body: JSON.stringify({
        ref: opts.ref ?? "main",
        inputs: { issue_number: String(opts.issueNumber) },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `dispatchEvolveWorkflow failed: ${res.status} ${await res.text()}`,
    );
  }
}

export async function countOpenIssuesWithLabel(opts: {
  token: string;
  repo: string;
  label: string;
}): Promise<number> {
  const q = encodeURIComponent(
    `repo:${opts.repo} is:issue is:open label:${opts.label}`,
  );
  const res = await fetch(`https://api.github.com/search/issues?q=${q}`, {
    headers: authHeaders(opts.token),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { total_count: number };
  return data.total_count;
}
