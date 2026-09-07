export async function createIssue(opts: {
  token: string;
  repo: string; // owner/name
  title: string;
  body: string;
  labels: string[];
}): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${opts.repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
      labels: opts.labels,
    }),
  });
  if (!res.ok) {
    throw new Error(`createIssue failed: ${res.status} ${await res.text()}`);
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
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { total_count: number };
  return data.total_count;
}
