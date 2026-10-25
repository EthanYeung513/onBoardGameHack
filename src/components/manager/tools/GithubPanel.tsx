"use client";

import { useAction } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { ConnectionLine, errorText, Modal, useConnector, useToast, type PanelProps } from "./shared";

// GitHub (P0): the card opens the mockup's modal asking for a fine-grained personal access token,
// also when already connected (paste a new token to update the connection). The token is verified
// with one GitHub call and stored write-only; it is never shown again.

export function GithubPanel({ spaceId, open, onClose }: PanelProps) {
  const connector = useConnector(spaceId, "github");
  const connect = useAction(api.connectorAuth.connectGithub);
  const toast = useToast();
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = Boolean(connector?.connected);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect({ spaceId, token, repos: repos.split(/[\s,]+/).filter(Boolean) });
      setToken("");
      onClose();
      toast("Agent is reading GitHub");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} label="GitHub">
      <form onSubmit={submit}>
        <h3>{update ? "Update GitHub" : "Connect GitHub"}</h3>
        <ConnectionLine spaceId={spaceId} type="github" />
        <p className="sub">
          {update ? "Paste a new token or change the repositories. " : ""}A fine-grained personal access token with read access to Contents, Issues, Pull requests and Members. Agents read READMEs, docs, PRs and issues.
        </p>
        <div className="field">
          <label htmlFor="gh-token">Personal access token</label>
          <input id="gh-token" type="password" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
        </div>
        <div className="field">
          <label htmlFor="gh-repos">Repositories (optional)</label>
          <input id="gh-repos" value={repos} onChange={(e) => setRepos(e.target.value)} placeholder="acme/handbook, acme/api (blank: all the token can read)" />
        </div>
        {error && <p className="panel-err">{error}</p>}
        <button className="btn btn-dark btn-block" disabled={busy || !token.trim()}>
          {busy ? "Checking token…" : update ? "Update connection" : "Connect"}
        </button>
      </form>
    </Modal>
  );
}
