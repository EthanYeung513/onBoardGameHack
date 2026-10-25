import { MAX_UPLOAD_BYTES } from "@convex/lib/connectors";
import { parseFile } from "./parse";
import type { Syncer } from "./types";

// Upload docs (P0): files the manager uploaded to Convex storage (connectors.addFiles queues them
// in `config.pending`) → parsed text → kind `file`. Re-uploading the same file name is a new
// version of the same item, so an updated handbook becomes a `changed` diff_event.

type Pending = { storageId: string; name: string; size: number };

export const fileExternalId = (name: string) => `files:${name.trim().toLowerCase()}`;

export const filesSyncer: Syncer = {
  service: "Upload docs",
  maxItems: 200,
  start(env) {
    const pending = (env.connector.config as { pending?: Pending[] } | undefined)?.pending ?? [];
    return pending.map((f) => ({ kind: "file", storageId: f.storageId, name: f.name, size: f.size }));
  },
  async run(task, env) {
    const storageId = String(task.storageId);
    const name = String(task.name);
    const done = async () => env.fileDone?.(storageId);
    const url = await env.fileUrl?.(storageId);
    if (!url) {
      await env.event("warn", `${name}: the upload is gone from storage, skipped`);
      return { after: done };
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: storage download failed (HTTP ${res.status})`);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      await env.event("warn", `${name}: larger than 5 MB, skipped`);
      return { after: done };
    }
    let text: string;
    try {
      text = await parseFile(name, bytes);
    } catch (e) {
      await env.event("warn", `${name}: could not be read (${e instanceof Error ? e.message : String(e)})`);
      return { after: done };
    }
    if (!text) {
      await env.event("warn", `${name}: no text found (scanned PDF?), skipped`);
      return { after: done };
    }
    return {
      docs: [{ kind: "file", externalId: fileExternalId(name), title: name, text, meta: { storageId, size: bytes.byteLength } }],
      after: done,
    };
  },
};
