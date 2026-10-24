import { stepPoints } from "@/lib/flow/scoring";
import type { FlowSpec, Step as SpecStep } from "@/lib/flow/spec";
import type { ProjectModel } from "@/lib/schemas/project-model";
import type { DesignTokens } from "@/lib/schemas/tokens";
import { isLight, retheme } from "./theme";
import type { Asset, Brand, Connector, Level, ScanResult, SkeletonBlock, Step, StepKind, Swatch, Typography } from "./types";

// Translates between the generator's data (project model, design tokens, FlowSpec) and the
// constructor UI's types. Pure functions, so both directions are unit tested.

export const firstFamily = (stack: string) => stack.split(",")[0].replace(/['"]/g, "").trim();

export function brandOf(t: DesignTokens): Brand {
  return { ink: t.colors.text, paper: t.colors.background, accent: t.colors.primary };
}

export function paletteOf(t: DesignTokens): Swatch[] {
  return [
    { name: "Primary", hex: t.colors.primary, role: "primary" },
    { name: "Accent", hex: t.colors.accent, role: "accent" },
    { name: "Surface", hex: t.colors.background, role: "surface" },
    { name: "Text", hex: t.colors.text, role: "text" },
  ];
}

export function typographyOf(t: DesignTokens): Typography {
  const base = t.typography.baseSizePx;
  return {
    heading: { family: firstFamily(t.typography.headingFont), weight: t.typography.headingWeight },
    body: { family: firstFamily(t.typography.bodyFont), weight: 400, metrics: `${base}/${Math.round(base * 1.5)}` },
    notes: `Radius ${t.radii.md} · ${t.mode === "dark" ? "Light on dark" : "Dark on light"}`,
  };
}

const PAGE_LABEL: Record<string, string> = {
  docs: "Docs",
  product: "Product",
  features: "Features",
  pricing: "Pricing",
  about: "About",
  careers: "Careers",
  changelog: "Changelog",
  customers: "Customers",
  integrations: "Integrations",
  blog: "Blog",
};

/** The wireframe drawn while scanning: one block per kind of page that was found. */
export function skeletonOf(siteName: string, pageTypes: string[], t: DesignTokens, heroLine: string): SkeletonBlock[] {
  const on = (c: string) => (isLight(c) ? t.colors.text : t.colors.background);
  const tint = `${t.colors.primary}1f`;
  const counts = new Map<string, number>();
  for (const p of pageTypes) counts.set(p, (counts.get(p) ?? 0) + 1);
  const blocks: SkeletonBlock[] = [{ label: `Nav · ${siteName}`, height: 34, width: 100, bg: t.colors.primary, fg: on(t.colors.primary) }];
  blocks.push({ label: `Hero · ${heroLine}`.slice(0, 60), height: 90, width: 100, bg: t.colors.accent, fg: on(t.colors.accent) });
  let i = 0;
  for (const [type, n] of counts) {
    const label = PAGE_LABEL[type];
    if (!label) continue;
    blocks.push({ label: n > 1 ? `${label} ×${n}` : label, height: 44, width: [70, 55, 85, 60][i++ % 4], bg: i % 2 ? tint : t.colors.surface, fg: t.colors.text });
  }
  blocks.push({ label: "Footer", height: 28, width: 100, bg: t.colors.primary, fg: on(t.colors.primary) });
  return blocks;
}

export function scanFindings(model: ProjectModel, pages: Array<{ page_type: string | null; fetch_method: string | null }>) {
  const types = pages.map((p) => p.page_type ?? "other");
  const named = [...new Set(types.map((t) => (t === "home" ? "Home" : PAGE_LABEL[t])).filter(Boolean))];
  const browser = pages.filter((p) => p.fetch_method === "browser").length;
  const outline = model.proposedOutline?.length ? model.proposedOutline : ["Welcome", ...model.gettingStarted.firstSteps.slice(0, 4), "Done"];
  return {
    category: model.category ?? model.productSummary.split(/[.:]/)[0].slice(0, 80),
    confidence: model.confidence ?? (pages.length >= 6 ? "high" : pages.length >= 3 ? "medium" : "low"),
    pageCount: pages.length,
    summary: `${named.join(", ") || "Home"}${pages.length > named.length ? ` and ${pages.length - named.length} more` : ""}.${browser ? ` ${browser} needed a browser to read.` : ""}`,
    tone: model.toneOfVoice.adjectives.slice(0, 4).join(", "),
    features: model.features.slice(0, 8).map((f) => f.name),
    ideas: (model.onboardingIdeas?.length ? model.onboardingIdeas : model.gettingStarted.firstSteps).slice(0, 3),
    structure: { outline, duration: model.duration ?? `About ${Math.max(1, Math.round(outline.length / 3))} minutes` },
  } satisfies Omit<ScanResult, "id" | "siteUrl" | "siteName" | "log" | "skeleton" | "palette" | "typography">;
}

const KIND_OF: Record<SpecStep["type"], StepKind> = {
  welcome: "welcome",
  single_choice: "choice",
  multiple_choice: "choice",
  quiz_question: "choice",
  text_input: "fields",
  email_signup: "fields",
  checklist: "toggles",
  feature_tour: "toggles",
  reward: "done",
};

const DEFAULT_BADGE: Record<StepKind, string> = { welcome: "Arrived", choice: "Decided", fields: "Introduced", toggles: "Set up", done: "Onboarded" };

/** Full marks for a step: every checklist item ticked, the right quiz answer. */
function idealPoints(step: SpecStep): number {
  if (step.type === "checklist") return stepPoints(step, step.items.map((i) => i.id));
  if (step.type === "quiz_question") return stepPoints(step, step.correctOptionIds);
  return stepPoints(step, true);
}

/** Background and accent for step i, cycling through the brand so each step has its own colour. */
function themeFor(i: number, last: boolean, t: DesignTokens, brand: Brand) {
  const c = t.colors;
  const cycle: Array<[string, string]> = [
    [c.background, c.primary],
    [c.primary, c.accent],
    [c.surface, c.primary],
    [c.text, c.accent],
  ];
  const [bg, accent0] = last ? [c.primary, c.background] : cycle[i % cycle.length];
  const accent = accent0.toLowerCase() === bg.toLowerCase() ? (isLight(bg) ? c.text : c.background) : accent0;
  return { bg, accent, brand };
}

export function toSteps(spec: FlowSpec, t: DesignTokens, model: Pick<ProjectModel, "features">): Step[] {
  const brand = brandOf(t);
  const badgeFor = new Map(spec.gamification.mechanics.badges.filter((b) => b.rule.kind === "step_completed").map((b) => [(b.rule as { stepId: string }).stepId, b.label]));
  const finalBadge = spec.gamification.mechanics.badges.at(-1)?.label;
  return spec.steps.map((s, i) => {
    const kind = KIND_OF[s.type];
    const base: Step = {
      id: s.id,
      title: s.title,
      description: s.body ?? "",
      kind,
      badge: badgeFor.get(s.id) ?? (kind === "done" && finalBadge ? finalBadge : DEFAULT_BADGE[kind]),
      xp: idealPoints(s),
      theme: { bg: "", fg: "", accent: "", onAccent: "" },
    };
    switch (s.type) {
      case "welcome":
        base.chips = model.features.slice(0, 3).map((f) => f.name);
        break;
      case "single_choice":
      case "multiple_choice":
      case "quiz_question":
        base.options = s.options.map((o) => o.label);
        break;
      case "text_input":
        base.fields = [{ label: s.inputLabel, value: s.placeholder ?? "" }];
        break;
      case "email_signup":
        base.fields = [{ label: s.inputLabel ?? "Email", value: s.placeholder ?? "you@company.com" }];
        break;
      case "checklist":
        base.toggles = s.items.map((it) => ({ title: it.label, description: it.hint ?? "", on: false }));
        break;
      case "feature_tour":
        base.toggles = s.cards.map((c) => ({ title: c.title, description: c.body, on: true }));
        break;
    }
    const th = themeFor(i, i === spec.steps.length - 1, t, brand);
    return retheme(base, brand, th.bg, th.accent);
  });
}

export function levelsOf(spec: FlowSpec, steps: Step[]): Level[] {
  const total = steps.reduce((sum, s) => sum + s.xp, 0) || 1;
  const pointBadges = spec.gamification.mechanics.badges.flatMap((b) => (b.rule.kind === "points_at_least" ? [{ at: Math.min(1, b.rule.points / total), name: b.label }] : []));
  const middle = pointBadges.length ? pointBadges : [{ at: 0.5, name: "On the path" }];
  const final = spec.gamification.mechanics.badges.at(-1)?.label ?? "Onboarded";
  const levels = [{ at: 0, name: "Newcomer" }, ...middle, { at: 1, name: final }].sort((a, b) => a.at - b.at);
  return levels.map((l, i) => ({ at: l.at, level: i + 1, name: l.name }));
}

const slug = (s: string, used: Set<string>) => {
  const base =
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "item";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
};

/**
 * Applies constructor edits back onto the FlowSpec. Steps keep their original type and settings
 * where the kind is unchanged; new or re-kinded steps get the closest FlowSpec step type.
 */
export function fromSteps(steps: Step[], base: FlowSpec): FlowSpec {
  const byId = new Map(base.steps.map((s) => [s.id, s]));
  const out: SpecStep[] = steps.map((s) => {
    const prev = byId.get(s.id);
    const transition = prev?.transition ?? "fade";
    const common = { id: s.id, title: s.title || "Untitled", body: s.description || undefined, transition };
    if (prev && KIND_OF[prev.type] === s.kind) {
      const next = { ...prev, ...common } as SpecStep;
      if ((next.type === "single_choice" || next.type === "multiple_choice" || next.type === "quiz_question") && s.options) {
        const used = new Set<string>();
        next.options = s.options.map((label, i) => ({ ...(next.options[i] ?? {}), id: next.options[i]?.id ?? slug(label, used), label }));
        if (next.type === "quiz_question") next.correctOptionIds = next.correctOptionIds.filter((id) => next.options.some((o) => o.id === id));
        if (next.type === "quiz_question" && next.correctOptionIds.length === 0) next.correctOptionIds = [next.options[0].id];
      }
      if (next.type === "text_input" && s.fields?.[0]) Object.assign(next, { inputLabel: s.fields[0].label, placeholder: s.fields[0].value || undefined });
      if (next.type === "email_signup" && s.fields?.[0]) Object.assign(next, { inputLabel: s.fields[0].label, placeholder: s.fields[0].value || undefined });
      if (next.type === "checklist" && s.toggles) {
        const used = new Set<string>();
        next.items = s.toggles.map((tg, i) => ({ id: next.items[i]?.id ?? slug(tg.title, used), label: tg.title, hint: tg.description || undefined }));
      }
      if (next.type === "feature_tour" && s.toggles) next.cards = s.toggles.map((tg, i) => ({ ...(next.cards[i] ?? {}), title: tg.title, body: tg.description || tg.title }));
      return next;
    }
    const used = new Set<string>();
    switch (s.kind) {
      case "welcome":
        return { ...common, type: "welcome" };
      case "choice":
        return { ...common, type: "single_choice", options: (s.options ?? ["Yes", "No"]).map((label) => ({ id: slug(label, used), label })) };
      case "fields":
        return { ...common, type: "text_input", inputLabel: s.fields?.[0]?.label ?? "Your answer", placeholder: s.fields?.[0]?.value || undefined };
      case "toggles":
        return { ...common, type: "checklist", items: (s.toggles ?? [{ title: "Done", description: "", on: false }]).map((tg) => ({ id: slug(tg.title, used), label: tg.title, hint: tg.description || undefined })) };
      case "done":
        return { ...common, type: "reward" };
    }
  });
  const keep = new Set(out.map((s) => s.id));
  const badges = base.gamification.mechanics.badges.filter((b) => b.rule.kind !== "step_completed" || keep.has(b.rule.stepId));
  // Branching survives only while every step it refers to still comes earlier in the flow.
  const steps2 = out.map((s, i) => {
    if (!s.showIf) return s;
    const earlier = new Set(out.slice(0, i).map((p) => p.id));
    const refs = [...(s.showIf.all ?? []), ...(s.showIf.any ?? [])].map((c) => c.stepId);
    return refs.every((r) => earlier.has(r)) ? s : ({ ...s, showIf: undefined } as SpecStep);
  });
  return { ...base, steps: steps2, gamification: { ...base.gamification, mechanics: { ...base.gamification.mechanics, badges } } };
}

export function assetsOf(model: ProjectModel, t: DesignTokens, steps: Step[], screenshots: Array<{ source_url: string }>): Asset[] {
  const c = t.colors;
  const glass = "rgba(255,255,255,.06)";
  const rows: Asset[] = [];
  const add = (category: string, name: string, meta: string, preview: Asset["preview"], source?: string) =>
    rows.push({ id: `asset-${rows.length + 1}`, category, name, meta, source, preview });
  add("Brand", "Wordmark", t.logo.url ? "From the site header" : "Company name", { bg: c.background, fg: c.text, glyph: model.companyName, size: 18, weight: t.typography.headingWeight });
  for (const s of screenshots) {
    const path = new URL(s.source_url).pathname || "/";
    add("Brand", `Screenshot ${path}`, "JPG · stored in Supabase", { bg: c.text, fg: c.background, glyph: "16:10", size: 12, weight: 600, mono: true }, path);
  }
  for (const sw of paletteOf(t)) add("Colors", sw.name, `${sw.hex} · ${sw.role}`, { bg: sw.hex, fg: isLight(sw.hex) ? c.text : c.background, glyph: sw.hex.replace("#", "").toUpperCase(), size: 11, weight: 500, mono: true });
  const ty = typographyOf(t);
  add("Type", ty.heading.family, `Headings · ${ty.heading.weight}`, { bg: c.background, fg: c.text, glyph: "Aa", size: 38, weight: ty.heading.weight });
  add("Type", ty.body.family, "Body · 400", { bg: c.background, fg: c.text, glyph: "Aa", size: 38, weight: 400 });
  for (const f of model.features.slice(0, 8)) {
    const text = (s: Step) => `${s.title} ${s.description} ${(s.options ?? []).join(" ")} ${(s.toggles ?? []).map((x) => x.title).join(" ")}`.toLowerCase();
    const at = steps.findIndex((s) => text(s).includes(f.name.toLowerCase().split(" ")[0]));
    const path = (() => {
      try {
        return new URL(f.sourceUrls[0]).pathname || "/";
      } catch {
        return "/";
      }
    })();
    add("Features", f.name, `${path} · ${at >= 0 ? `step ${at + 1}` : "later"}`, { bg: glass, fg: at >= 0 ? c.accent : "rgba(255,255,255,.45)", glyph: "◆", size: 30, weight: 400 }, path);
  }
  add("Copy", "Tagline", "/ · hero", { bg: c.background, fg: c.text, glyph: model.valuePropositions[0]?.slice(0, 48) ?? model.companyName, size: 12, weight: 600 });
  add("Copy", "Tone", "From the site copy", { bg: c.background, fg: c.text, glyph: model.toneOfVoice.adjectives.slice(0, 3).join(". ") + ".", size: 12, weight: 500 });
  return rows;
}

export function connectorsOf(hasRepo: boolean): Connector[] {
  return [
    { id: "github", name: "GitHub", mono: "GH", bg: "#fff", fg: "#121212", description: "Pull request with React components (not connected in this MVP)", enabled: hasRepo },
    { id: "vercel", name: "Vercel", mono: "▲", bg: "#121212", fg: "#fff", description: "Publishes a public onboarding page from this app", enabled: true },
    { id: "supabase", name: "Supabase", mono: "SB", bg: "#3ECF8E", fg: "#0F3D2E", description: "Stores sign-ups and every version", enabled: true },
    { id: "cloudflare", name: "Cloudflare", mono: "CF", bg: "#F6821F", fg: "#fff", description: "Renders client-side pages and screenshots", enabled: true },
  ];
}

/** Rewrites pipeline events into the plain progress lines the scan and build screens show. */
export function friendlyLog(messages: string[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    let line: string | null = m;
    if (/^Model call extract_design/.test(m)) line = "Reading the brand from the evidence and a screenshot";
    else if (/^Model call analyse/.test(m)) line = "Summarising the product, audience and tone";
    else if (/^Model call generate_flow/.test(m)) line = null;
    else if (/^Model call /.test(m)) line = null;
    else if (/ started$/.test(m) || /^Waiting for/.test(m) || /^Findings confirmed|^Answers saved/.test(m)) line = null;
    if (line && out[out.length - 1] !== line) out.push(line);
  }
  return out;
}
