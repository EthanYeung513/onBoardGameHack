import { getJson, postJson } from "@/lib/api";
import type { BuildRequest, Project, PublishResult, PushResult, ScanResult, ShipRequest } from "./types";

/**
 * Browser-side client for the Orthogonal backend. Defaults to this app's own route handlers; set
 * NEXT_PUBLIC_ORTHOGONAL_API_URL to point the UI at a separately deployed backend with the same endpoints.
 */
const base = (process.env.NEXT_PUBLIC_ORTHOGONAL_API_URL ?? "/api/orthogonal").replace(/\/$/, "");

export const orthogonalApi = {
  scan: (url: string) => postJson<ScanResult>(`${base}/scans`, { url }),
  getScan: (id: string) => getJson<ScanResult>(`${base}/scans/${encodeURIComponent(id)}`),
  build: (req: BuildRequest) => postJson<Project>(`${base}/projects`, req),
  getProject: (id: string) => getJson<Project>(`${base}/projects/${encodeURIComponent(id)}`),
  push: (id: string, req: ShipRequest) => postJson<PushResult>(`${base}/projects/${encodeURIComponent(id)}/push`, req),
  publish: (id: string, req: ShipRequest) => postJson<PublishResult>(`${base}/projects/${encodeURIComponent(id)}/publish`, req),
};
