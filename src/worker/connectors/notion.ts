import type { Syncer, Task } from "./types";

// Notion (P1) via the Nango proxy: pages shared with the integration, newest edits first. The
// page's last_edited_time is its revision, so unchanged pages are never refetched; incremental
// syncs stop at the first page older than `since`. External id: notion:<page id>.

export const NOTION_CAPS = { pages: 60, pageSize: 25, blockPages: 3 };
const VERSION = { "Notion-Version": "2022-06-28" };

type RichText = { plain_text?: string }[];
type NotionPage = { id: string; url?: string; last_edited_time: string; properties?: Record<string, { type?: string; title?: RichText }> };
export type NotionBlock = { type: string; has_children?: boolean } & Record<string, unknown>;

export function pageTitle(p: NotionPage): string {
  for (const prop of Object.values(p.properties ?? {})) if (prop.type === "title" && prop.title?.length) return prop.title.map((t) => t.plain_text ?? "").join("");
  return "Untitled";
}

const PREFIX: Record<string, string> = { heading_1: "# ", heading_2: "## ", heading_3: "### ", bulleted_list_item: "- ", numbered_list_item: "1. ", to_do: "- [ ] ", quote: "> ", callout: "> " };

/** Notion blocks → Markdown-ish text. */
export function blocksToText(blocks: NotionBlock[]): string {
  return blocks
    .map((b) => {
      const body = b[b.type] as { rich_text?: RichText; checked?: boolean } | undefined;
      const text = (body?.rich_text ?? []).map((t) => t.plain_text ?? "").join("");
      if (!text) return "";
      const prefix = b.type === "to_do" && body?.checked ? "- [x] " : (PREFIX[b.type] ?? "");
      return b.type === "code" ? `\`\`\`\n${text}\n\`\`\`` : `${prefix}${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export const notionSyncer: Syncer = {
  service: "Notion",
  maxItems: NOTION_CAPS.pages,
  start: () => [{ kind: "search", seen: 0 }],
  async run(task, env) {
    if (task.kind === "search") {
      const body: Record<string, unknown> = { filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: NOTION_CAPS.pageSize };
      if (task.cursor) body.start_cursor = task.cursor;
      const r = await env.http.json<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>("/v1/search", { method: "POST", body, headers: VERSION });
      const known = await env.known("notion:");
      const tasks: Task[] = [];
      const touch: string[] = [];
      let reachedSince = false;
      for (const p of r.results) {
        if (env.since && p.last_edited_time < env.since) {
          reachedSince = true;
          break;
        }
        const id = `notion:${p.id}`;
        if (known.get(id) === p.last_edited_time) touch.push(id);
        else tasks.push({ kind: "page", id: p.id, title: pageTitle(p), url: p.url ?? null, rev: p.last_edited_time });
      }
      const seen = Number(task.seen ?? 0) + r.results.length;
      const more = r.has_more && r.next_cursor && !reachedSince && seen < NOTION_CAPS.pages;
      if (more) tasks.push({ kind: "search", cursor: r.next_cursor, seen });
      // Only a full, uncapped enumeration can tell that a page disappeared.
      const complete = !env.since && !r.has_more;
      return { tasks, touch, sweep: complete ? ["notion:"] : [] };
    }
    if (task.kind === "page") {
      const blocks: NotionBlock[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < NOTION_CAPS.blockPages; i++) {
        const r: { results: NotionBlock[]; has_more: boolean; next_cursor: string | null } = await env.http.json(
          `/v1/blocks/${encodeURIComponent(String(task.id))}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`,
          { headers: VERSION },
        );
        blocks.push(...r.results);
        if (!r.has_more || !r.next_cursor) break;
        cursor = r.next_cursor;
      }
      const title = String(task.title);
      return {
        docs: [{ kind: "doc", externalId: `notion:${task.id}`, url: (task.url as string | null) ?? undefined, title, text: `# ${title}\n\n${blocksToText(blocks)}`, meta: { rev: String(task.rev) } }],
      };
    }
    throw new Error(`Notion: unknown task ${task.kind}`);
  },
};
