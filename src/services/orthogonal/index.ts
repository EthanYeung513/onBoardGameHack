import { normaliseSiteUrl, siteNameOf } from "@/lib/orthogonal/site";
import type { BuildRequest, Project, PublishResult, PushResult, ScanResult, ShipRequest } from "@/lib/orthogonal/types";
import * as demo from "./demo";

/**
 * Orthogonal backend, currently a stand-in that answers every site with the Lumen demo. To wire in the real
 * crawler, agent and deploy targets, replace these bodies and keep the return shapes: the UI only depends on them.
 */

/** Short, stable id for a site, so the same URL always maps to the same project. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 4);
}

const slug = (siteUrl: string) => siteNameOf(siteUrl).toLowerCase();
const defaultRepo = (siteUrl: string) => `${slug(siteUrl)}/web`;

export async function scanSite(url: string): Promise<ScanResult> {
  const siteUrl = normaliseSiteUrl(url);
  return {
    id: `scan-${slug(siteUrl)}-${shortHash(siteUrl)}`,
    siteUrl,
    siteName: siteNameOf(siteUrl),
    log: demo.scanLog(siteUrl),
    skeleton: demo.skeleton,
    palette: demo.palette,
    typography: demo.typography,
    ...demo.findings,
  };
}

export async function buildProject(req: BuildRequest): Promise<Project> {
  const siteUrl = normaliseSiteUrl(req.siteUrl);
  const siteName = siteNameOf(siteUrl);
  return {
    id: `${slug(siteUrl)}-${shortHash(siteUrl)}`,
    siteUrl,
    siteName,
    repo: req.repo,
    brand: demo.brand,
    palette: demo.palette,
    typography: demo.typography,
    log: demo.buildLog,
    steps: demo.steps(siteName),
    levels: demo.levels,
    assets: demo.assets,
    connectors: demo.connectors(siteUrl, req.repo !== null),
  };
}

export async function pushProject(_id: string, req: ShipRequest): Promise<PushResult> {
  const repo = req.repo ?? defaultRepo(req.siteUrl);
  return { repo, branch: "orthogonal/onboarding", pullRequestUrl: `https://github.com/${repo}/pulls` };
}

export async function publishProject(id: string, req: ShipRequest): Promise<PublishResult> {
  const siteUrl = normaliseSiteUrl(req.siteUrl);
  if (!req.connectors.vercel) return { host: `cdn.orthogonal.dev/${id}`, via: "orthogonal", storage: null };
  return { host: `onboarding.${siteUrl}`, via: "vercel", storage: req.connectors.supabase ? "supabase" : null };
}
