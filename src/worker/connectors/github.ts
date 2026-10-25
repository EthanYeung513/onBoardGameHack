import type { SyncDoc, Syncer, Task } from "./types";
import { HttpError } from "./http";

// GitHub (P0) via a fine-grained PAT: repos → README / CONTRIBUTING / docs/**/*.md (blob sha as
// revision, so unchanged files are never refetched), recent issues + PRs (incremental with
// `since`), and org members. External ids: github:<owner/repo>:doc:<path>,
// github:<owner/repo>:issue:<n>, github:<owner/repo>:pr:<n>, github:org:<org>:members.

export const GITHUB_CAPS = { repos: 10, docsPerRepo: 40, issuesPerRepo: 50, maxBlobBytes: 500_000 };

type Repo = { full_name: string; default_branch: string; owner: { login: string; type: string }; archived?: boolean; description?: string | null };
type TreeEntry = { path: string; type: string; sha: string; size?: number };
type Issue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: { login: string } | null;
  labels: ({ name?: string } | string)[];
  pull_request?: unknown;
  updated_at: string;
};

/** The knowledge-bearing files we read from a repo tree. */
export function isDocPath(path: string): boolean {
  const p = path.toLowerCase();
  if (/^(readme|contributing)(\.(md|markdown|mdx|txt|rst))?$/.test(p)) return true;
  if (/^\.github\/(contributing|pull_request_template)\.md$/.test(p)) return true;
  return /^docs\/.+\.(md|markdown|mdx)$/.test(p);
}

export function issueDoc(repo: string, i: Issue): SyncDoc {
  const kind = i.pull_request ? "pr" : "issue";
  const labels = i.labels.map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
  const head = [`${kind === "pr" ? "Pull request" : "Issue"} #${i.number} in ${repo} · ${i.state}`, i.user ? `opened by @${i.user.login}` : "", labels.length ? `labels: ${labels.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ");
  return {
    kind,
    externalId: `github:${repo}:${kind}:${i.number}`,
    url: i.html_url,
    title: `${repo}#${i.number} ${i.title}`,
    text: `# ${i.title}\n\n${head}\n\n${(i.body ?? "").slice(0, 20_000)}`,
    meta: { repo, number: i.number, state: i.state, author: i.user?.login ?? null, rev: i.updated_at },
  };
}

export function membersDoc(org: string, members: { login: string; html_url: string }[]): SyncDoc {
  return {
    kind: "doc",
    externalId: `github:org:${org}:members`,
    url: `https://github.com/orgs/${org}/people`,
    title: `${org} members on GitHub`,
    text: `# People in the ${org} GitHub organisation\n\n${members.map((m) => `- @${m.login} (${m.html_url})`).join("\n")}`,
    meta: { org, count: members.length },
  };
}

const repoPath = (repo: string) => repo.split("/").map(encodeURIComponent).join("/");

export const githubSyncer: Syncer = {
  service: "GitHub",
  maxItems: 400,
  start: () => [{ kind: "repos" }],
  async run(task, env) {
    const configured = ((env.connector.config as { repos?: string[] } | undefined)?.repos ?? []).filter(Boolean);
    switch (task.kind) {
      case "repos": {
        let repos: Repo[];
        if (configured.length) {
          repos = [];
          for (const r of configured.slice(0, GITHUB_CAPS.repos)) repos.push(await env.http.json<Repo>(`/repos/${repoPath(r)}`));
        } else {
          repos = (await env.http.json<Repo[]>("/user/repos?per_page=100&sort=pushed&direction=desc")).filter((r) => !r.archived).slice(0, GITHUB_CAPS.repos);
        }
        await env.event("info", `GitHub: reading ${repos.length} repo${repos.length === 1 ? "" : "s"}`, { repos: repos.map((r) => r.full_name) });
        const orgs = [...new Set(repos.filter((r) => r.owner.type === "Organization").map((r) => r.owner.login))];
        const tasks: Task[] = repos.flatMap((r) => [
          { kind: "tree", repo: r.full_name, branch: r.default_branch },
          { kind: "issues", repo: r.full_name },
        ]);
        return { tasks: [...tasks, ...orgs.map((org) => ({ kind: "members", org }))] };
      }
      case "tree": {
        const repo = String(task.repo);
        const branch = String(task.branch);
        let tree: { tree: TreeEntry[]; truncated: boolean };
        try {
          tree = await env.http.json(`/repos/${repoPath(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
        } catch (e) {
          if (e instanceof HttpError && (e.status === 409 || e.status === 404)) return {}; // empty repo
          throw e;
        }
        const docs = tree.tree.filter((t) => t.type === "blob" && isDocPath(t.path) && (t.size ?? 0) <= GITHUB_CAPS.maxBlobBytes);
        const capped = tree.truncated || docs.length > GITHUB_CAPS.docsPerRepo;
        const prefix = `github:${repo}:doc:`;
        const known = await env.known(prefix);
        const touch: string[] = [];
        const tasks: Task[] = [];
        for (const d of docs.slice(0, GITHUB_CAPS.docsPerRepo)) {
          const id = `${prefix}${d.path}`;
          if (known.get(id) === d.sha) touch.push(id);
          else tasks.push({ kind: "blob", repo, branch, path: d.path, sha: d.sha });
        }
        return { tasks, touch, sweep: capped ? [] : [prefix], capped };
      }
      case "blob": {
        const repo = String(task.repo);
        const path = String(task.path);
        const blob = await env.http.json<{ content: string; encoding: string }>(`/repos/${repoPath(repo)}/git/blobs/${task.sha}`);
        const text = blob.encoding === "base64" ? Buffer.from(blob.content, "base64").toString("utf8") : blob.content;
        return {
          docs: [
            {
              kind: "doc",
              externalId: `github:${repo}:doc:${path}`,
              url: `https://github.com/${repo}/blob/${task.branch}/${path}`,
              title: `${repo}/${path}`,
              text,
              meta: { repo, path, rev: String(task.sha) },
            },
          ],
        };
      }
      case "issues": {
        const repo = String(task.repo);
        const since = env.since ? `&since=${encodeURIComponent(env.since)}` : "";
        const issues = await env.http.json<Issue[]>(`/repos/${repoPath(repo)}/issues?state=all&sort=updated&direction=desc&per_page=${GITHUB_CAPS.issuesPerRepo}${since}`);
        return { docs: issues.map((i) => issueDoc(repo, i)) };
      }
      case "members": {
        const org = String(task.org);
        try {
          const members = await env.http.json<{ login: string; html_url: string }[]>(`/orgs/${encodeURIComponent(org)}/members?per_page=100`);
          return { docs: members.length ? [membersDoc(org, members)] : [] };
        } catch (e) {
          if (e instanceof HttpError && (e.status === 403 || e.status === 404)) {
            await env.event("warn", `GitHub: the token can't list members of ${org} (needs organisation Members: read)`);
            return {};
          }
          throw e;
        }
      }
      default:
        throw new Error(`GitHub: unknown task ${task.kind}`);
    }
  },
};
