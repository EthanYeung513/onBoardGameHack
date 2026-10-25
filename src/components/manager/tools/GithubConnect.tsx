"use client";

import { useAction } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorText, StatusSlot, useConnector, useToast } from "./shared";

// GitHub (P0): the mockup's Connect button opens the mockup's `.overlay > .modal` (styles.css)
// asking for a fine-grained personal access token. The token is verified with one GitHub call and
// stored write-only; it is never shown again.

export function GithubConnect({ spaceId }: { spaceId: Id<"spaces"> }) {
  const connector = useConnector(spaceId, "github");
  const connect = useAction(api.connectorAuth.connectGithub);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect({ spaceId, token, repos: repos.split(/[\s,]+/).filter(Boolean) });
      setOpen(false);
      setToken("");
      toast("Agent is reading GitHub");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StatusSlot
        connector={connector}
        button={
          <button className="btn btn-dark" onClick={() => setOpen(true)} title={connector?.error ?? undefined}>
            Connect
          </button>
        }
      />
      <div className={`overlay${open ? " open" : ""}`} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
        <form className="modal" onSubmit={submit}>
          <button type="button" className="x" aria-label="Close" onClick={() => setOpen(false)}>
            ×
          </button>
          <h3>Connect GitHub</h3>
          <p className="sub">Paste a fine-grained personal access token with read access to Contents, Issues, Pull requests and Members. Agents read READMEs, docs, PRs and issues.</p>
          <div className="field">
            <label htmlFor="gh-token">Personal access token</label>
            <input id="gh-token" type="password" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
          </div>
          <div className="field">
            <label htmlFor="gh-repos">Repositories (optional)</label>
            <input id="gh-repos" value={repos} onChange={(e) => setRepos(e.target.value)} placeholder="acme/handbook, acme/apill the token can read" />
          </div>
          {error && <p style={{ color: "#e11d48", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <button className="btn btn-dark btn-block" disabled={busy || !token.trim()}>
            {busy ? "Checking token…" : "Connect"}
          </button>
        </form>
      </div>
    </>
  );
}
