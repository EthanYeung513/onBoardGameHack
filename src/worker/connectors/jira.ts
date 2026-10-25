import type { SyncDoc, Syncer } from "./types";

// Jira (P1) via the Nango proxy (Nango's Jira provider resolves the Atlassian cloud id): projects
// overview + issues, incremental by `updated >= since`. External ids: jira:projects, jira:<KEY-1>.

export const JIRA_CAPS = { issues: 150, pageSize: 50 };

type Adf = { type?: string; text?: string; content?: Adf[] };
type JiraIssue = {
  key: string;
  self?: string;
  fields: {
    summary: string;
    description?: Adf | string | null;
    status?: { name?: string };
    assignee?: { displayName?: string } | null;
    reporter?: { displayName?: string } | null;
    issuetype?: { name?: string };
    project?: { key?: string; name?: string };
    labels?: string[];
    updated?: string;
  };
};

/** Atlassian Document Format → plain text (paragraphs on new lines). */
export function adfToText(node: Adf | string | null | undefined): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text ?? "";
  const inner = (node.content ?? []).map(adfToText).join(node.type === "doc" || node.type === "bulletList" || node.type === "orderedList" ? "\n" : "");
  return node.type === "paragraph" || node.type === "heading" || node.type === "listItem" ? `${inner}\n` : inner;
}

export function jiraIssueDoc(i: JiraIssue): SyncDoc {
  const f = i.fields;
  const facts = [f.issuetype?.name, f.status?.name && `status: ${f.status.name}`, f.assignee?.displayName && `assignee: ${f.assignee.displayName}`, f.reporter?.displayName && `reporter: ${f.reporter.displayName}`, f.labels?.length && `labels: ${f.labels.join(", ")}`]
    .filter(Boolean)
    .join(" · ");
  return {
    kind: "issue",
    externalId: `jira:${i.key}`,
    title: `${i.key} ${f.summary}`,
    text: `# ${i.key}: ${f.summary}\n\n${f.project?.name ? `Project ${f.project.name} · ` : ""}${facts}\n\n${adfToText(f.description).trim()}`,
    meta: { key: i.key, project: f.project?.key ?? null, status: f.status?.name ?? null, rev: f.updated ?? null },
  };
}

/** JQL for a sync: everything (newest first) on a full sync, `updated >= since` incrementally. */
export function jiraJql(since: string | null): string {
  if (!since) return "order by updated DESC";
  const d = new Date(since);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `updated >= "${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}" order by updated DESC`;
}

export const jiraSyncer: Syncer = {
  service: "Jira",
  maxItems: JIRA_CAPS.issues + 1,
  start: () => [{ kind: "projects" }],
  async run(task, env) {
    if (task.kind === "projects") {
      const r = await env.http.json<{ values: { key: string; name: string; lead?: { displayName?: string }; projectTypeKey?: string }[] }>("/rest/api/3/project/search?maxResults=50");
      const doc: SyncDoc = {
        kind: "doc",
        externalId: "jira:projects",
        title: "Jira projects",
        text: `# Jira projects\n\n${r.values.map((p) => `- ${p.key}: ${p.name}${p.lead?.displayName ? ` (lead: ${p.lead.displayName})` : ""}`).join("\n")}`,
        meta: { count: r.values.length },
      };
      return { docs: [doc], tasks: [{ kind: "issues", fetched: 0 }] };
    }
    if (task.kind === "issues") {
      const fetched = Number(task.fetched ?? 0);
      const params = new URLSearchParams({
        jql: jiraJql(env.since),
        maxResults: String(JIRA_CAPS.pageSize),
        fields: "summary,description,status,assignee,reporter,issuetype,project,labels,updated",
      });
      if (task.next) params.set("nextPageToken", String(task.next));
      const r = await env.http.json<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>(`/rest/api/3/search/jql?${params}`);
      const total = fetched + r.issues.length;
      const more = r.nextPageToken && !r.isLast && total < JIRA_CAPS.issues;
      return { docs: r.issues.map(jiraIssueDoc), tasks: more ? [{ kind: "issues", fetched: total, next: r.nextPageToken }] : [] };
    }
    throw new Error(`Jira: unknown task ${task.kind}`);
  },
};
