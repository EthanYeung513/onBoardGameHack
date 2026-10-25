import type { EntityType, ExtractionBatch, FactCategory } from "./types";

// OFFLINE STAND-IN for brain extraction (no MUBIT_API_KEY). Deterministic rules over one chunk:
// headings → terms, "X owns/leads/runs Y" → people/teams, a fixed list of tool names → tools.
// Confidence is capped well below any auto-approve threshold so every offline fact lands as a
// draft for review; callers record `mode: "offline"` in audit rows. Never presented as live.

export const OFFLINE_CONFIDENCE = 0.55;

const TOOLS = [
  "Slack",
  "GitHub",
  "Google Workspace",
  "Google Docs",
  "Gmail",
  "Notion",
  "Jira",
  "Linear",
  "Confluence",
  "Zendesk",
  "Intercom",
  "Figma",
  "Salesforce",
  "HubSpot",
  "Vault",
  "Expenses app",
  "People app",
  "deploy CLI",
  "PagerDuty",
  "Datadog",
  "1Password",
  "Okta",
];

const TEAM_WORDS = /\b(team|support|engineering|compliance|operations|sales|finance|legal|marketing|people|it|security|product|design|ops)\b/i;
const RITUAL_WORDS = /\b(rota|on-call|oncall|standup|stand-up|weekly|daily|nightly|every (monday|tuesday|wednesday|thursday|friday|working day)|retro|handover|all-hands)\b/i;
const POLICY_WORDS = /\b(never|must|always|not allowed|approval|approve|policy|required|mandatory|within \d+ (days|hours|minutes))\b/i;

function sentences(text: string): { s: string; start: number }[] {
  const out: { s: string; start: number }[] = [];
  const re = /[^.!?\n]+[.!?]?/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[0];
    const s = raw.replace(/^[\s\-*\d.]+/, "").replace(/\*\*/g, "").trim();
    if (s.length >= 12) out.push({ s, start: m.index + raw.indexOf(raw.trimStart()) });
  }
  return out;
}

function categorise(s: string, heading: string): FactCategory {
  if (RITUAL_WORDS.test(s)) return "Rituals";
  if (POLICY_WORDS.test(s)) return "Policy";
  if (/\b(owns|leads|runs|manager|lead)\b/i.test(s)) return "People";
  if (TOOLS.some((t) => s.includes(t))) return "Tools";
  if (/history|postmortem|incident/i.test(heading)) return "Docs & History";
  return "Glossary";
}

export function offlineExtract(text: string): ExtractionBatch {
  const entities = new Map<string, ExtractionBatch["entities"][number]>();
  const addEntity = (type: EntityType, name: string) => {
    const clean = name.replace(/\*\*/g, "").trim();
    if (clean.length < 2 || clean.length > 80) return null;
    const k = `${type}:${clean.toLowerCase()}`;
    if (!entities.has(k)) entities.set(k, { type, name: clean, aliases: [], keys: {} });
    return clean;
  };
  const facts: ExtractionBatch["facts"] = [];
  const edges: ExtractionBatch["edges"] = [];

  const heading = text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ?? "";
  const headingTerm = heading ? addEntity("term", heading) : null;

  const tools = TOOLS.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
  for (const t of tools) addEntity("tool", t);

  for (const { s, start } of sentences(text)) {
    if (/^#/.test(s) || facts.length >= 12) continue;
    const names: string[] = [];
    const own = s.match(/^((?:[A-Z][\w&-]*\s?){1,4}?)\s+(owns|leads|runs)\s+(.+)$/);
    if (own) {
      const who = own[1].trim();
      const owner = addEntity(TEAM_WORDS.test(who) ? "org_unit" : "person", who);
      if (owner) {
        names.push(owner);
        for (const t of tools.filter((t) => own[3].includes(t))) edges.push({ source: owner, target: t, relation: "owns", evidence: s.slice(0, 300) });
        if (headingTerm && !tools.some((t) => own[3].includes(t))) edges.push({ source: owner, target: headingTerm, relation: "related_to", evidence: s.slice(0, 300) });
      }
    }
    for (const t of tools) if (s.includes(t)) names.push(t);
    const category = categorise(s, heading);
    // Keep sentences that carry a rule, an owner, a tool or a ritual; plain prose stays out.
    if (category === "Glossary" && !headingTerm) continue;
    if (headingTerm && !names.length) names.push(headingTerm);
    facts.push({
      category,
      text: (heading && category === "Glossary" ? `${heading}: ${s}` : s).slice(0, 400),
      entity_names: [...new Set(names)],
      confidence: OFFLINE_CONFIDENCE,
      span: { start, end: start + s.length },
    });
  }
  for (const t of tools) if (headingTerm) edges.push({ source: headingTerm, target: t, relation: "mentions", evidence: heading });
  return { facts, entities: [...entities.values()], edges };
}
