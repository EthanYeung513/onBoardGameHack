"use client";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorText, Modal, useToast, type PanelProps } from "./shared";

// Upload docs (P0): the card always opens this page, however many docs are already in, so the
// manager can keep adding more. PDF / Markdown / DOCX / text up to 5 MB go to Convex storage, then
// the worker parses and ingests them. The list shows what's queued and what's been read.

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
      if (r.accepted) toast(`Agent is reading ${r.accepted} doc${r.accepted === 1 ? "" : "s"}`);
      if (r.rejected.length) toast(r.rejected.map((x) => `${x.name}: ${x.reason}`).join(" · "));
    } catch (err) {
      toast(errorText(err));
    }
  };
}

const kb = (n: number | null) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function FilesPanel({ spaceId, open, onClose }: PanelProps) {
  const list = useQuery(api.connectors.uploads, open ? { spaceId } : "skip");
  const upload = useUploadFiles(spaceId);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function send(files: File[]) {
    setBusy(true);
    await upload(files);
    setBusy(false);
  }

  const empty = list && !list.pending.length && !list.read.length;
  return (
    <Modal open={open} onClose={onClose} label="Upload docs">
      <h3>Upload docs</h3>
      <p className="sub">PDFs, Markdown, Word or text files up to 5 MB each. Agents read them into the company brain. Upload more at any time.</p>
      <button
        type="button"
        className={`drop${over ? " over" : ""}`}
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send([...e.dataTransfer.files]);
        }}
      >
        <b>{busy ? "Uploading…" : "Choose files or drop them here"}</b>
        <span>PDF · MD · DOCX · TXT</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        data-testid="files-input"
        onChange={(e) => {
          void send([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <h4 className="up-h">Uploaded</h4>
      {!list ? (
        <p className="panel-note">Loading…</p>
      ) : empty ? (
        <p className="panel-note">Nothing uploaded yet.</p>
      ) : (
        <ul className="up-list" aria-label="Uploaded docs">
          {list.pending.map((f, i) => (
            <li key={`p${i}`}>
              <span>{f.name}</span>
              <span className="pill inv">Reading…</span>
            </li>
          ))}
          {list.read.map((f) => (
            <li key={f._id}>
              <span>{f.name}</span>
              <span className="up-meta">{kb(f.size)}</span>
              <span className="pill live">Read ✓</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Internal web app (P2): no browsing agent yet. The card still opens and says so honestly. */
export function WebappPanel({ open, onClose }: PanelProps) {
  return (
    <Modal open={open} onClose={onClose} label="Internal web app">
      <h3>Internal web app</h3>
      <p className="sub">An agent logs in to your internal tool, browses it and learns how it works.</p>
      <p className="panel-note">Not available yet: the browsing agent is still being built, so there is nothing to connect here today.</p>
      <button className="btn btn-dark btn-block" disabled>
        Connect
      </button>
    </Modal>
  );
}
