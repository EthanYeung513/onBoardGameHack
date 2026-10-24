/**
 * The contract between the Orthogonal constructor UI and its backend. Everything here crosses the wire as JSON,
 * so a real backend only has to return these shapes from the endpoints in `client.ts`.
 */

export type StepKind = "welcome" | "choice" | "fields" | "toggles" | "done";

export interface Swatch {
  name: string;
  hex: string;
  role: "primary" | "accent" | "surface" | "text";
}

export interface FontSpec {
  family: string;
  weight: number;
  /** Size/line-height, e.g. "16/24". */
  metrics?: string;
}

export interface Typography {
  heading: FontSpec;
  body: FontSpec;
  /** One-line summary of the shape language, e.g. "Radius 12 · Buttons pill · Dark-on-cream". */
  notes: string;
}

/** A block of the wireframe drawn while the site is being read. */
export interface SkeletonBlock {
  label: string;
  height: number;
  /** Percentage of the frame's width. */
  width: number;
  bg: string;
  fg: string;
}

export interface ScanResult {
  id: string;
  /** Host and path, no scheme or trailing slash: "lumen.energy". */
  siteUrl: string;
  siteName: string;
  /** Progress lines, revealed one at a time while scanning. */
  log: string[];
  skeleton: SkeletonBlock[];
  /** What we think the product is: "a home solar monitoring app". */
  category: string;
  confidence: "low" | "medium" | "high";
  pageCount: number;
  /** One sentence on what was found: "Marketing, pricing, docs, …". */
  summary: string;
  tone: string;
  palette: Swatch[];
  typography: Typography;
  features: string[];
  ideas: string[];
  /** Proposed step names and how long the flow takes. */
  structure: { outline: string[]; duration: string };
  /** Set by a live backend: the scan keeps running until status is "ready". Absent for instant results. */
  status?: LiveStatus;
  /** 0 to 1 while running. */
  progress?: number;
  error?: string;
  /** Where the full pipeline view for this site lives. */
  studioUrl?: string;
}

export type LiveStatus = "running" | "building" | "ready" | "failed";

export interface Field {
  label: string;
  value: string;
  /** "select" shows a chevron, "computed" is read-only and dimmed. */
  kind?: "text" | "select" | "computed";
}

export interface Toggle {
  title: string;
  description: string;
  on: boolean;
}

/** Colours of one step. Hover and track tints are derived from `fg` on the client. */
export interface StepTheme {
  bg: string;
  fg: string;
  accent: string;
  onAccent: string;
}

export interface Step {
  id: string;
  title: string;
  description: string;
  kind: StepKind;
  badge: string;
  xp: number;
  theme: StepTheme;
  options?: string[];
  fields?: Field[];
  toggles?: Toggle[];
  chips?: string[];
}

export interface Level {
  /** Share of total XP (0–1) at which this level starts. */
  at: number;
  level: number;
  name: string;
}

export interface Asset {
  id: string;
  category: string;
  name: string;
  meta: string;
  /** Page the asset was found on, e.g. "/features". */
  source?: string;
  preview: { bg: string; fg: string; glyph: string; size: number; weight: number; mono?: boolean };
}

export type ConnectorId = "github" | "vercel" | "supabase" | "cloudflare";

export interface Connector {
  id: ConnectorId;
  name: string;
  /** Two-letter monogram shown in the tile. */
  mono: string;
  bg: string;
  fg: string;
  description: string;
  enabled: boolean;
}

/** The brand colours steps are re-themed with: dark text, light text and the default accent. */
export interface Brand {
  ink: string;
  paper: string;
  accent: string;
}

export interface BuildLogEntry {
  text: string;
  /** Set when this entry finishes writing a step (1-based). */
  step?: number;
}

export interface Project {
  id: string;
  siteUrl: string;
  siteName: string;
  /** "owner/name", or null when GitHub was skipped. */
  repo: string | null;
  brand: Brand;
  palette: Swatch[];
  typography: Typography;
  log: BuildLogEntry[];
  steps: Step[];
  levels: Level[];
  assets: Asset[];
  connectors: Connector[];
  /** Set by a live backend: steps keep arriving until status is "ready". Absent for instant results. */
  status?: LiveStatus;
  error?: string;
  studioUrl?: string;
}

export interface ScanRequest {
  url: string;
}

export interface BuildRequest {
  scanId: string;
  siteUrl: string;
  repo: string | null;
  description: string;
}

/** Push and publish send the edited steps, since all editing happens on the client. */
export interface ShipRequest {
  siteUrl: string;
  repo: string | null;
  steps: Step[];
  connectors: Record<ConnectorId, boolean>;
}

export interface PushResult {
  repo: string;
  branch: string;
  pullRequestUrl: string;
}

export interface PublishResult {
  /** Where the onboarding is live: "onboarding.lumen.energy". */
  host: string;
  via: "vercel" | "orthogonal";
  /** Set when answers and progress are stored in the customer's own database. */
  storage: "supabase" | null;
}
