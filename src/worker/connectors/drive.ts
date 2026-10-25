import { MAX_UPLOAD_BYTES } from "@convex/lib/connectors";
import { parseFile } from "./parse";
import type { Syncer, Task } from "./types";

// Google Drive (P1) via the Nango proxy: Google Docs (exported as text) and PDFs (parsed), newest
// first; modifiedTime is the revision, incremental syncs ask only for files modified since the
// last sync. External id: drive:<file id>.

export const DRIVE_CAPS = { files: 60, pageSize: 50 };
const GDOC = "application/vnd.google-apps.document";
const PDF = "application/pdf";

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string; size?: string };

export function driveQuery(since: string | null): string {
  const base = `(mimeType='${GDOC}' or mimeType='${PDF}') and trashed=false`;
  return since ? `${base} and modifiedTime > '${since}'` : base;
}

export const driveSyncer: Syncer = {
  service: "Google Drive",
  maxItems: DRIVE_CAPS.files,
  start: () => [{ kind: "list", seen: 0 }],
  async run(task, env) {
    if (task.kind === "list") {
      const params = new URLSearchParams({
        q: driveQuery(env.since),
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size)",
        orderBy: "modifiedTime desc",
        pageSize: String(DRIVE_CAPS.pageSize),
      });
      if (task.page) params.set("pageToken", String(task.page));
      const r = await env.http.json<{ files: DriveFile[]; nextPageToken?: string }>(`/drive/v3/files?${params}`);
      const known = await env.known("drive:");
      const tasks: Task[] = [];
      const touch: string[] = [];
      for (const f of r.files) {
        const id = `drive:${f.id}`;
        if (known.get(id) === f.modifiedTime) touch.push(id);
        else if (Number(f.size ?? 0) <= MAX_UPLOAD_BYTES) tasks.push({ kind: "file", id: f.id, name: f.name, mimeType: f.mimeType, rev: f.modifiedTime, url: f.webViewLink ?? null });
      }
      const seen = Number(task.seen ?? 0) + r.files.length;
      if (r.nextPageToken && seen < DRIVE_CAPS.files) tasks.push({ kind: "list", page: r.nextPageToken, seen });
      const complete = !env.since && !r.nextPageToken;
      return { tasks, touch, sweep: complete ? ["drive:"] : [] };
    }
    if (task.kind === "file") {
      const id = encodeURIComponent(String(task.id));
      const name = String(task.name);
      const isDoc = task.mimeType === GDOC;
      const text = isDoc ? await env.http.text(`/drive/v3/files/${id}/export?mimeType=text/plain`) : await parseFile(name, await env.http.bytes(`/drive/v3/files/${id}?alt=media`), PDF);
      if (!text.trim()) return {};
      return {
        docs: [{ kind: isDoc ? "doc" : "file", externalId: `drive:${task.id}`, url: (task.url as string | null) ?? undefined, title: name, text, meta: { mimeType: task.mimeType, rev: String(task.rev) } }],
      };
    }
    throw new Error(`Google Drive: unknown task ${task.kind}`);
  },
};
