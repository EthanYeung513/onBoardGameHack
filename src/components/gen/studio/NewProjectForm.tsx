"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Cached = { projectId: string; createdAt: string; pages: number } | null;

export function NewProjectForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [cached, setCached] = useState<Cached>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (url.trim().length < 4) return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/gen/cache?url=${encodeURIComponent(url.trim())}`);
      if (r.ok) setCached((await r.json()).cached);
    }, 400);
    return () => clearTimeout(t);
  }, [url]);

  const shownCache = url.trim().length >= 4 ? cached : null;

  async function start(useCachedFrom?: string) {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/gen/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, useCachedFrom }) });
    const json = await r.json();
    if (!r.ok) {
      setError(json.error ?? "Could not start the project");
      setBusy(false);
      return;
    }
    router.push(`/studio/projects/${json.project.id}`);
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <label className="block space-y-1">
        <span className="font-medium">Company website</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="g-input text-lg" placeholder="https://www.example.com" value={url} onChange={(e) => setUrl(e.target.value)} required data-testid="new-project-url" />
          <button className="g-btn justify-center" type="submit" disabled={busy || url.trim().length < 4} data-testid="new-project-submit">
            {busy ? "Starting" : "Crawl and analyse"}
          </button>
        </div>
      </label>
      {shownCache && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg p-3 text-sm" style={{ background: "#fff7e3", border: "1px solid var(--g-marigold)" }}>
          <span>
            This site was crawled {new Date(shownCache.createdAt).toLocaleString()} ({shownCache.pages} pages). Reusing it saves browser time.
          </span>
          <button type="button" className="g-btn g-btn-quiet py-1 text-sm" disabled={busy} onClick={() => void start(shownCache.projectId)} data-testid="use-cached-crawl">
            Use cached crawl
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--g-danger)" }}>
          {error}
        </p>
      )}
    </form>
  );
}
