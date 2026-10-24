import type { Asset, BuildLogEntry, Connector, Level, ScanResult, Step, StepTheme } from "@/lib/orthogonal/types";

/**
 * The Lumen demo: what the scanner and builder return until real ones are wired in. Only the site URL and name
 * change with the visitor's input; everything else describes lumen.energy.
 */

const PINE = "#0F3D2E";
const SUN = "#F5B400";
const CREAM = "#FBF7EE";
const SLATE = "#1E2A2B";
const GLASS = "rgba(255,255,255,.06)";

export const brand = { ink: PINE, paper: CREAM, accent: SUN };

export const palette: ScanResult["palette"] = [
  { name: "Pine", hex: PINE, role: "primary" },
  { name: "Sun", hex: SUN, role: "accent" },
  { name: "Cream", hex: CREAM, role: "surface" },
  { name: "Slate", hex: SLATE, role: "text" },
];

export const typography: ScanResult["typography"] = {
  heading: { family: "Söhne", weight: 600 },
  body: { family: "Söhne Buch", weight: 400, metrics: "16/24" },
  notes: "Radius 12 · Buttons pill · Dark-on-cream",
};

export function scanLog(siteUrl: string): string[] {
  return [
    `Resolving ${siteUrl}`,
    "Found 14 pages via sitemap.xml",
    "Reading /pricing, /features, /docs",
    "Extracting palette from CSS and imagery",
    "Detecting type: Söhne, 2 weights",
    "Mapping product surface: 6 features",
    "Summarising copy and tone",
    "Drafting onboarding structure",
  ];
}

export const skeleton: ScanResult["skeleton"] = [
  { label: "Nav · Lumen", height: 34, width: 100, bg: PINE, fg: CREAM },
  { label: "Hero · See what your roof makes", height: 90, width: 100, bg: SUN, fg: PINE },
  { label: "Features ×6", height: 48, width: 70, bg: "rgba(15,61,46,.12)", fg: PINE },
  { label: "Pricing · 3 tiers", height: 48, width: 55, bg: "rgba(15,61,46,.12)", fg: PINE },
  { label: "Integrations · SolarEdge, Enphase, Fronius", height: 40, width: 85, bg: "#fff", fg: PINE },
  { label: "Docs · 41 changelog entries", height: 40, width: 60, bg: "#fff", fg: PINE },
  { label: "Footer", height: 28, width: 100, bg: PINE, fg: CREAM },
];

export const findings = {
  category: "a home solar monitoring app",
  confidence: "high" as const,
  pageCount: 14,
  summary: "Marketing, pricing, docs, 3 integration guides, a changelog with 41 entries.",
  tone: "plain, warm, numbers-first",
  features: [
    "Live production dashboard",
    "Inverter integrations (SolarEdge, Enphase, Fronius)",
    "Savings vs. utility bill",
    "Weather-aware forecasts",
    "Household sharing",
    "Outage alerts",
  ],
  ideas: [
    "Ask for the inverter brand first. It is the only hard step.",
    "Show a forecast before asking about tariffs.",
    "Default alerts to outages only; ask about the rest later.",
  ],
  structure: { outline: ["Welcome", "Connect inverter", "Roof", "Tariff", "Alerts", "Live"], duration: "About 2 minutes" },
};

const theme = (bg: string, fg: string, accent: string, onAccent: string): StepTheme => ({ bg, fg, accent, onAccent });

export function steps(siteName: string): Step[] {
  return [
    {
      id: "welcome",
      title: `Welcome to ${siteName}`,
      description: "Two minutes. Six steps. Your roof starts reporting at sunrise.",
      kind: "welcome",
      badge: "First light",
      xp: 20,
      theme: theme(CREAM, PINE, SUN, PINE),
      chips: ["Live production", "Real savings", "Outage alerts"],
    },
    {
      id: "inverter",
      title: "Which inverter do you have?",
      description: "We handle the handshake.",
      kind: "choice",
      badge: "Paired",
      xp: 20,
      theme: theme(PINE, CREAM, SUN, PINE),
      options: ["SolarEdge", "Enphase", "Fronius", "Something else"],
    },
    {
      id: "roof",
      title: "Tell us about your roof.",
      description: "Panels and orientation make the forecast real.",
      kind: "fields",
      badge: "Roof mapped",
      xp: 20,
      theme: theme(SUN, PINE, PINE, CREAM),
      fields: [
        { label: "Panels", value: "18" },
        { label: "Facing", value: "South-west", kind: "select" },
        { label: "System size", value: "7.2 kW · auto", kind: "computed" },
      ],
    },
    {
      id: "tariff",
      title: "How do you pay for power?",
      description: "So savings are numbers, not estimates.",
      kind: "choice",
      badge: "Tariff set",
      xp: 20,
      theme: theme(CREAM, PINE, PINE, CREAM),
      options: ["Time-of-use", "Flat rate", "Net metering"],
    },
    {
      id: "alerts",
      title: "When should we reach you?",
      description: "Outages are on. The rest is up to you.",
      kind: "toggles",
      badge: "On watch",
      xp: 20,
      theme: theme(SLATE, CREAM, SUN, PINE),
      toggles: [
        { title: "Outages", description: "When production unexpectedly drops to zero", on: true },
        { title: "Daily summary", description: "Yesterday's output, every morning", on: false },
        { title: "Savings milestones", description: "Every $100 saved", on: false },
      ],
    },
    {
      id: "live",
      title: "You're live.",
      description: "First production reading arrives at sunrise.",
      kind: "done",
      badge: "Sun catcher",
      xp: 20,
      theme: theme(PINE, CREAM, SUN, PINE),
    },
  ];
}

export const levels: Level[] = [
  { at: 0, level: 1, name: "Rookie" },
  { at: 0.5, level: 1, name: "Rising" },
  { at: 1, level: 2, name: "Sun catcher" },
];

export const buildLog: BuildLogEntry[] = [
  { text: "Reading extraction · 6 features, 4 colours, 2 fonts" },
  { text: "Applying Lumen palette: one colour per step" },
  { text: "Step 1 · Welcome", step: 1 },
  { text: "Step 2 · Connect your inverter", step: 2 },
  { text: "Pulling brand list from /docs/integrations" },
  { text: "Step 3 · Tell us about your roof", step: 3 },
  { text: "Step 4 · Your utility & tariff", step: 4 },
  { text: "Step 5 · Alerts that matter", step: 5 },
  { text: "Step 6 · You're live", step: 6 },
  { text: "Assigning XP, levels and badges per step" },
  { text: "Wiring progress, skip logic and resume" },
  { text: "Onboarding ready" },
];

type AssetRow = [category: string, name: string, meta: string, bg: string, fg: string, glyph: string, size: number, weight: number, mono?: boolean];

const assetRows: AssetRow[] = [
  ["Brand", "Logo mark", "SVG · 24×24", CREAM, PINE, "● Lumen", 15, 700],
  ["Brand", "Wordmark dark", "SVG · on pine", PINE, CREAM, "Lumen", 18, 700],
  ["Brand", "Hero image", "JPG · 1600×900", SLATE, "rgba(251,247,238,.55)", "16:9", 12, 600, true],
  ["Brand", "Favicon", "PNG · 32×32", SUN, PINE, "●", 28, 400],
  ["Colors", "Pine", "#0F3D2E · primary", PINE, "rgba(251,247,238,.7)", "0F3D2E", 11, 500, true],
  ["Colors", "Sun", "#F5B400 · accent", SUN, "rgba(15,61,46,.7)", "F5B400", 11, 500, true],
  ["Colors", "Cream", "#FBF7EE · surface", CREAM, "rgba(15,61,46,.6)", "FBF7EE", 11, 500, true],
  ["Colors", "Slate", "#1E2A2B · text", SLATE, "rgba(251,247,238,.6)", "1E2A2B", 11, 500, true],
  ["Type", "Söhne", "Headings · 600", CREAM, PINE, "Aa", 38, 600],
  ["Type", "Söhne Buch", "Body · 400", CREAM, PINE, "Aa", 38, 400],
  ["Features", "Live dashboard", "/features · step 6", GLASS, SUN, "▤", 30, 400],
  ["Features", "Inverter pairing", "/docs/integrations · step 2", GLASS, SUN, "◐", 30, 400],
  ["Features", "Savings vs. bill", "/pricing · step 4", GLASS, SUN, "◆", 30, 400],
  ["Features", "Forecasts", "/features · step 3", GLASS, SUN, "◠", 30, 400],
  ["Features", "Household sharing", "/features · later", GLASS, "rgba(255,255,255,.45)", "◎", 30, 400],
  ["Features", "Outage alerts", "/features · step 5", GLASS, SUN, "▲", 30, 400],
  ["Icons", "Sun", "SVG · 20", GLASS, CREAM, "☼", 30, 400],
  ["Icons", "Home", "SVG · 20", GLASS, CREAM, "⌂", 30, 400],
  ["Icons", "Bolt", "SVG · 20", GLASS, CREAM, "↯", 30, 400],
  ["Icons", "Check", "SVG · 20", GLASS, CREAM, "✓", 30, 400],
  ["Copy", "Tagline", "/ · hero", CREAM, PINE, "See what your roof makes.", 12, 600],
  ["Copy", "Tone", "41 changelog entries", CREAM, PINE, "Plain. Warm. Numbers first.", 12, 500],
];

export const assets: Asset[] = assetRows.map(([category, name, meta, bg, fg, glyph, size, weight, mono], i) => ({
  id: `asset-${i + 1}`,
  category,
  name,
  meta,
  source: meta.startsWith("/") ? meta.split(" · ")[0] : undefined,
  preview: { bg, fg, glyph, size, weight, mono },
}));

export function connectors(siteUrl: string, hasRepo: boolean): Connector[] {
  return [
    { id: "github", name: "GitHub", mono: "GH", bg: "#fff", fg: "#121212", description: "Pull request with React components", enabled: hasRepo },
    { id: "vercel", name: "Vercel", mono: "▲", bg: "#121212", fg: "#fff", description: `Deploys to onboarding.${siteUrl}`, enabled: true },
    { id: "supabase", name: "Supabase", mono: "SB", bg: "#3ECF8E", fg: "#0F3D2E", description: "Stores answers, XP and progress", enabled: true },
    { id: "cloudflare", name: "Cloudflare", mono: "CF", bg: "#F6821F", fg: "#fff", description: "Serves o.js from the edge", enabled: false },
  ];
}
