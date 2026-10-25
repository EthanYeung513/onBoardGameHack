import type { SyncDoc, Syncer, Task } from "./types";

// Slack (P1) via the Nango proxy: public channel list + the last `days` of history from channels
// the app is a member of. Messages are batched per channel-day into one source item
// (slack:<channel>:<YYYY-MM-DD>), so an edited or deleted message makes that day `changed`, and a
// day whose messages were all deleted is swept as `removed`. The window starts at UTC midnight so
// the oldest day never shrinks between syncs.

export const SLACK_CAPS = { channels: 20, days: 14, pagesPerChannel: 5 };

type SlackResponse = { ok: boolean; error?: string; response_metadata?: { next_cursor?: string } };
type Channel = { id: string; name: string; is_member?: boolean; is_archived?: boolean; purpose?: { value?: string }; topic?: { value?: string }; num_members?: number };
export type SlackMessage = { ts: string; user?: string; username?: string; text?: string; subtype?: string; user_profile?: { real_name?: string } };

const DAY = 86_400_000;
export const dayOf = (ts: string) => new Date(Number(ts) * 1000).toISOString().slice(0, 10);

function check<T extends SlackResponse>(r: T, what: string): T {
  if (!r.ok) throw new Error(`Slack ${what}: ${r.error ?? "unknown error"}`);
  return r;
}

/** Window start (UTC midnight `days` ago) and every day key in the window. */
export function windowDays(now: number, days = SLACK_CAPS.days): { oldest: number; days: string[] } {
  const start = Math.floor(now / DAY) * DAY - (days - 1) * DAY;
  return { oldest: start / 1000, days: Array.from({ length: days }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10)) };
}

export function channelDayDocs(channel: { id: string; name: string }, messages: SlackMessage[], names: Record<string, string> = {}): SyncDoc[] {
  const byDay = new Map<string, SlackMessage[]>();
  for (const m of messages) {
    if (!m.text || (m.subtype && m.subtype !== "thread_broadcast" && m.subtype !== "bot_message")) continue;
    const d = dayOf(m.ts);
    byDay.set(d, [...(byDay.get(d) ?? []), m]);
  }
  return [...byDay.entries()].map(([day, msgs]) => {
    const lines = msgs
      .sort((a, b) => Number(a.ts) - Number(b.ts))
      .map((m) => {
        const who = m.user_profile?.real_name ?? (m.user ? names[m.user] : undefined) ?? m.username ?? m.user ?? "someone";
        return `[${new Date(Number(m.ts) * 1000).toISOString().slice(11, 16)}] ${who}: ${m.text}`;
      });
    return {
      kind: "message" as const,
      externalId: `slack:${channel.id}:${day}`,
      url: `https://slack.com/app_redirect?channel=${channel.id}`,
      title: `#${channel.name} — ${day}`,
      text: `# #${channel.name} on ${day}\n\n${lines.join("\n")}`,
      meta: { channel: channel.id, channelName: channel.name, day, messages: msgs.length },
    };
  });
}

export const slackSyncer: Syncer = {
  service: "Slack",
  maxItems: 400,
  start: () => [{ kind: "channels" }],
  async run(task, env) {
    if (task.kind === "channels") {
      const list = check(await env.http.json<SlackResponse & { channels: Channel[] }>("/conversations.list?types=public_channel&exclude_archived=true&limit=200"), "conversations.list");
      const users = await env.http
        .json<SlackResponse & { members?: { id: string; real_name?: string; name?: string }[] }>("/users.list?limit=200")
        .catch(() => ({ ok: false, members: [] }));
      const names = Object.fromEntries((users.members ?? []).map((u) => [u.id, u.real_name || u.name || u.id]));
      const channels = list.channels.filter((c) => !c.is_archived);
      const readable = channels.filter((c) => c.is_member).slice(0, SLACK_CAPS.channels);
      const skipped = channels.filter((c) => !c.is_member).length;
      if (skipped) await env.event("info", `Slack: ${skipped} public channel${skipped === 1 ? "" : "s"} skipped — invite the app to read history`);
      const doc: SyncDoc = {
        kind: "doc",
        externalId: "slack:channels",
        title: "Slack channels",
        text: `# Public Slack channels\n\n${channels.map((c) => `- #${c.name}${c.purpose?.value ? ` — ${c.purpose.value}` : c.topic?.value ? ` — ${c.topic.value}` : ""}`).join("\n")}`,
        meta: { count: channels.length },
      };
      const tasks: Task[] = readable.map((c) => ({ kind: "history", id: c.id, name: c.name, names }));
      return { docs: [doc], tasks };
    }
    if (task.kind === "history") {
      const channel = { id: String(task.id), name: String(task.name) };
      const { oldest, days } = windowDays(Date.now());
      const messages: SlackMessage[] = [];
      let cursor = "";
      let pages = 0;
      do {
        const r = check(
          await env.http.json<SlackResponse & { messages: SlackMessage[]; has_more?: boolean }>(
            `/conversations.history?channel=${channel.id}&oldest=${oldest}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          ),
          `conversations.history #${channel.name}`,
        );
        messages.push(...r.messages);
        cursor = r.response_metadata?.next_cursor ?? "";
        pages++;
      } while (cursor && pages < SLACK_CAPS.pagesPerChannel);
      const docs = channelDayDocs(channel, messages, (task.names as Record<string, string>) ?? {});
      const seen = new Set(docs.map((d) => d.externalId));
      const capped = Boolean(cursor);
      return { docs, capped, sweep: capped ? [] : days.map((d) => `slack:${channel.id}:${d}`).filter((id) => !seen.has(id)) };
    }
    throw new Error(`Slack: unknown task ${task.kind}`);
  },
};
