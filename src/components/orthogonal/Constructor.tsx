"use client";

import { useEffect, useState } from "react";
import { orthogonalApi } from "@/lib/orthogonal/client";
import { normaliseSiteUrl } from "@/lib/orthogonal/site";
import type { Project, ScanResult } from "@/lib/orthogonal/types";
import { ExtractStage } from "./ExtractStage";
import { Hero } from "./Hero";
import { DescribeStage, GithubStage } from "./Questions";
import { ScanStage } from "./ScanStage";
import { Workbench } from "./workbench/Workbench";

export type Pace = "fast" | "realistic" | "cinematic";
const SPEED: Record<Pace, number> = { fast: 0.2, realistic: 0.55, cinematic: 1 };

type Stage = "hero" | "scan" | "github" | "describe" | "extract" | "build";

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
      setProject(await orthogonalApi.build({ scanId: scan.id, siteUrl: scan.siteUrl, repo, description }));
      setStage("build");
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
      return <ScanStage siteUrl={scan?.siteUrl ?? normaliseSiteUrl(url)} scan={scan} speed={speed} onDone={() => setStage(skipGithub ? "describe" : "github")} />;
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
    case "build":
      return project ? <Workbench project={project} speed={speed} /> : null;
  }
}
