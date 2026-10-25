"use client";

import { useMutation } from "convex/react";
import { useRef } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorText, StatusSlot, useConnector, useToast } from "./shared";

// Upload docs (P0): the mockup's Connect opens the file picker; files can also be dropped anywhere
// on the Tools tab (the mockup's "Drop files anywhere"). PDF / Markdown / DOCX / text ≤ 5 MB go to
// Convex storage, then the worker parses and ingests them.

export const ACCEPT = ".pdf,.md,.markdown,.txt,.docx";

export function useUploadFiles(spaceId: Id<"spaces">) {
  const uploadUrl = useMutation(api.connectors.generateUploadUrl);
  const addFiles = useMutation(api.connectors.addFiles);
  const toast = useToast();
  return async (files: File[]) => {
    if (!files.length) return;
    try {
      const uploaded: { storageId: Id<"_storage">; name: string }[] = [];
      for (const file of files) {
        const url = await uploadUrl({ spaceId });
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!res.ok) throw new Error(`${file.name}: upload failed`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        uploaded.push({ storageId, name: file.name });
      }
      const r = await addFiles({ spaceId, files: uploaded });
      if (r.accepted) toast("Agent is reading Upload docs — brain updated");
      if (r.rejected.length) toast(r.rejected.map((x) => `${x.name}: ${x.reason}`).join(" · "));
    } catch (err) {
      toast(errorText(err));
    }
  };
}

export function FilesConnect({ spaceId }: { spaceId: Id<"spaces"> }) {
  const connector = useConnector(spaceId, "files");
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadFiles(spaceId);
  return (
    <>
      <StatusSlot
        connector={connector}
        button={
          <button className="btn btn-dark" onClick={() => input.current?.click()} title={connector?.error ?? undefined}>
            Connect
          </button>
        }
      />
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          void upload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** Internal web app (P2): no browsing agent yet — the mockup's button stays, disabled and honest. */
export function WebappConnect() {
  return (
    <button className="btn btn-dark" disabled title="Internal web app access is not available yet">
      Connect
    </button>
  );
}
