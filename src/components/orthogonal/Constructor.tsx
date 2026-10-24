"use client";

import { useEffect, useState } from "react";
import { orthogonalApi } from "@/lib/orthogonal/client";
import { normaliseSiteUrl } from "@/lib/orthogonal/site";
import type { Project, ScanResult } from "@/lib/orthogonal/types";
import { ExtractStage } from "./ExtractStage";
import { LiveProgress } from "./LiveProgress";
import { Hero } from "./Hero";
import { DescribeStage, GithubStage } from "./Questions";
import { ScanStage } from "./ScanStage";
import { Workbench } from "./workbench/Workbench";

export type Pace = "fast" | "realistic" | "cinematic";
const SPEED: Record<Pace, number> = { fast: 0.2, realistic: 0.55, cinematic: 1 };

type Stage = "hero" | "scan" | "github" | "describe" | "extract" | "building" | "build";

const POLL_MS = 2000;

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

/**
 * The whole Orthogonal flow: URL → scan → (GitHub) → describe → findings → build/edit. This component owns the
 * flow state and the backend calls; each stage is a presentational component.
 */
export function Constructor({ pace = "cinematic", skipGithub = false }: { pace?: Pace; skipGithub?: boolean }) {
  const speed = SPEED[pace];
  const [stage, setStage] = useState<Stage>("hero");
  const [url, setUrl] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage]);

  // A live backend answers before the work is done; poll until it reports ready or failed.
  const scanId = scan?.status === "running" ? scan.id : null;
  useEffect(() => {
    if (!scanId) return;
    const t = setInterval(async () => {
      try {
        setScan(await orthogonalApi.getScan(scanId));
      } catch {
        // A missed poll is retried on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [scanId]);

  const projectId = stage === "building" && project?.status === "building" ? project.id : null;
  useEffect(() => {
    if (!projectId) return;
    const t = setInterval(async () => {
      try {
        const next = await orthogonalApi.getProject(projectId);
        setProject(next);
        if (next.status === "ready") setStage("build");
      } catch {
        // Retried on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [projectId]);

  const resume = async (id: string) => {
    await fetch(`/api/gen/projects/${encodeURIComponent(id)}/resume`, { method: "POST" });
    if (stage === "scan") setScan((s) => (s ? { ...s, status: "running", error: undefined } : s));
    else setProject((p) => (p ? { ...p, status: "building", error: undefined } : p));
  };

  const startScan = async () => {
    setError(null);
    setScan(null);
    setStage("scan");
    try {
      setScan(await orthogonalApi.scan(url));
    } catch (err) {
      setError(message(err));
      setStage("hero");
    }
  };

  const startBuild = async () => {
    if (!scan) return;
    setError(null);
    setBusy(true);
    try {
      const built = await orthogonalApi.build({ scanId: scan.id, siteUrl: scan.siteUrl, repo, description });
      setProject(built);
      setStage(built.status === undefined || built.status === "ready" ? "build" : "building");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  switch (stage) {
    case "hero":
      return <Hero url={url} onUrl={setUrl} onScan={startScan} error={error} />;
    case "scan":
      return (
        <ScanStage
          siteUrl={scan?.siteUrl ?? normaliseSiteUrl(url)}
          scan={scan}
          speed={speed}
          onDone={() => setStage(skipGithub ? "describe" : "github")}
          onRetry={scan ? () => void resume(scan.id) : undefined}
        />
      );
    case "github":
      return (
        <GithubStage
          placeholder={`${scan?.siteName.toLowerCase() ?? "acme"}/web`}
          onConnect={(r) => {
            setRepo(r);
            setStage("describe");
          }}
          onSkip={() => setStage("describe")}
        />
      );
    case "describe":
      return scan ? (
        <DescribeStage
          siteName={scan.siteName}
          category={scan.category}
          confidence={scan.confidence}
          pageCount={scan.pageCount}
          onNext={(d) => {
            setDescription(d);
            setStage("extract");
          }}
        />
      ) : null;
    case "extract":
      return scan ? <ExtractStage scan={scan} onBuild={startBuild} busy={busy} error={error} /> : null;
    case "building":
      return project && scan ? (
        <LiveProgress
          siteUrl={project.siteUrl}
          trail="building"
          heading={
            <>
              Writing your
              <br />
              onboarding.
            </>
          }
          lines={project.log.map((e) => e.text)}
          finished={false}
          progress={Math.min(0.9, 0.15 + project.log.length * 0.08)}
          blocks={scan.structure.outline.map((label, i) => ({ label: `${i + 1} · ${label}`, height: 40, width: 100 - (i % 3) * 12, bg: i % 2 ? project.brand.accent : project.brand.ink, fg: i % 2 ? project.brand.ink : project.brand.paper }))}
          surface={project.brand.paper}
          ink={project.brand.ink}
          error={project.status === "failed" ? project.error : undefined}
          onRetry={() => void resume(project.id)}
          studioUrl={project.studioUrl}
        />
      ) : null;
    case "build":
      return project ? <Workbench project={project} speed={speed} /> : null;
  }
}
