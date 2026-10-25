import { describe, expect, it, vi } from "vitest";
import { buildDecision, toRecord } from "@/lib/brand/decision";
import { computeRecommendation, BRAND_RECOMMEND_TASK } from "@/lib/brand/recommend";
import { learnedRecommend } from "@/lib/brand/ranker";
import { normaliseCandidates } from "@/lib/brand/normalise";
import { BRAND_FIELDS, type DecisionRecord } from "@/lib/brand/types";
import { BRAND_RECOMMEND_SYSTEM_PROMPT } from "@/lib/prompts";
import { MubitBrandFeedbackSink, getBrandFeedbackSink } from "@/services/brand-feedback";
import type { Llm } from "@/worker/providers/llm";
import { hashedEmbedding } from "@/worker/providers/embed";

const offline: Llm = { live: false, json: async () => Promise.reject(new Error("offline")) };
const embed = { mode: "offline" as const, embed: async (t: string[]) => t.map((x) => hashedEmbedding(x)) };

/** A site whose most-used radius is small but which also uses pills. */
function site(host: string, primary: string) {
  return {
    host,
    candidates: {
      colors: [
        { hex: "#111111", usage: 100, where: ["context:body"] },
        { hex: primary, usage: 30, where: ["css-var:--brand", "role:button"] },
        { hex: "#ff7a00", usage: 8, where: ["css-var:--accent"] },
      ],
      radii: [{ value: "6px", usage: 60 }, { value: "999px", usage: 20 }, { value: "0px", usage: 5 }],
      fonts: [{ family: "Brand Display", usage: 10, context: "heading" }, { family: "Inter", usage: 80, context: "body" }],
    },
  };
}

async function decide(s: ReturnType<typeof site>, picks: Partial<Record<(typeof BRAND_FIELDS)[number], string>>, history: DecisionRecord[] = []) {
  const rec = await computeRecommendation({ llm: offline, embed, history: async () => history }, s.candidates, { host: s.host });
  return Object.entries(picks).map(([f, v]) => toRecord(rec, buildDecision(rec, f as (typeof BRAND_FIELDS)[number], v!)));
}

describe("brand ranker", () => {
  it("cold start: heuristic picks the CSS brand colour, the heading face and the most-used radius", () => {
    const r = learnedRecommend(normaliseCandidates(site("a.com", "#635bff").candidates), []);
    expect(r.primary).toMatchObject({ recommended: "#635bff", source: "heuristic" });
    expect(r.accent.recommended).toBe("#ff7a00");
    expect(r.radius.recommended).toBe("6px");
    expect(r.headline.recommended).toBe("Brand Display");
  });

  it("learns a preference from other companies' decisions (managers keep choosing pills)", async () => {
    const history = (await Promise.all(["b.com", "c.com", "d.com", "e.com"].map((h) => decide(site(h, "#0061fe"), { radius: "999px" })))).flat();
    const r = learnedRecommend(normaliseCandidates(site("new.com", "#1ed760").candidates), history, { host: "new.com" });
    expect(r.radius).toMatchObject({ recommended: "999px", source: "learned" });
    expect(r.radius.reason).toMatch(/learned from 4 decisions/);
  });

  it("a returning company gets its own last choice first time", async () => {
    const own = await decide(site("acme.com", "#635bff"), { accent: "#111111", headline: "Inter" });
    const r = learnedRecommend(normaliseCandidates(site("acme.com", "#635bff").candidates), own, { host: "www.acme.com" });
    expect(r.accent).toMatchObject({ recommended: "#111111", reason: "chosen for www.acme.com before" });
    expect(r.headline.recommended).toBe("Inter");
    expect(r.primary.source).toBe("heuristic");
  });

  it("reads the scan-stages candidate shape (hints + evidence)", () => {
    const c = normaliseCandidates({
      palette: [{ value: "#0a0a0a", count: 50, evidence: ["stylesheets: 50 rules"], hints: [] }, { value: "#e11d48", count: 5, evidence: ["css var --color-primary", "meta theme-color"], hints: [{ role: "primary", by: "site" }] }],
      radius: [{ value: "0.5rem", count: 3, evidence: [], hints: [] }],
      headline: [{ value: "Fraunces", count: 2, evidence: [], hints: [] }],
    });
    expect(c.colors.find((x) => x.value === "#e11d48")?.where).toEqual(expect.arrayContaining(["role:primary", "css-var:--color-primary", "theme-color"]));
    expect(c.radii[0].value).toBe("8px");
    expect(learnedRecommend(c, []).headline.recommended).toBe("Fraunces");
  });
});

describe("brand.recommend through the Mubit adapter (mocked)", () => {
  it("tags the task, keeps the fixed system prompt, rejects non-candidates and keeps the request id", async () => {
    const json = vi.fn(async (req: Parameters<Llm["json"]>[0]) => {
      const value = { primary: { recommended: "#ff7a00", reason: "warm" }, accent: { recommended: "#111111", reason: "dark" }, radius: { recommended: "999px", reason: "pills" }, headline: { recommended: "Brand Display", reason: "display" } };
      // The adapter feeds validate() errors back to the model; a made-up value must be caught.
      expect(req.validate?.({ ...value, primary: { recommended: "#123456", reason: "x" } } as never)).toEqual(['primary.recommended "#123456" is not one of the primary candidates']);
      return { value: value as never, mode: "live" as const, model: "gpt-5.4-mini", requestId: "mreq_abc" };
    });
    const llm: Llm = { live: true, json: json as Llm["json"] };
    const rec = await computeRecommendation({ llm, embed, history: async () => [] }, site("a.com", "#635bff").candidates, { host: "a.com" });
    const req = json.mock.calls[0][0];
    expect(req.task).toBe(BRAND_RECOMMEND_TASK);
    expect(req.system).toBe(BRAND_RECOMMEND_SYSTEM_PROMPT);
    expect(JSON.parse(req.user).company.host).toBe("a.com");
    expect(rec.requestId).toBe("mreq_abc");
    expect(rec.fields.primary).toMatchObject({ recommended: "#ff7a00", source: "mubit", reason: "warm" });
    expect(rec.fields.primary.candidates[0].value).toBe("#ff7a00");
  });

  it("falls back to the learned ranker when the Mubit call fails, and says so", async () => {
    const llm: Llm = { live: true, json: async () => Promise.reject(new Error("gateway 500")) };
    const log = vi.fn(async () => undefined);
    const rec = await computeRecommendation({ llm, embed, history: async () => [], log }, site("a.com", "#635bff").candidates, { host: "a.com" });
    expect(rec.fields.primary.source).toBe("heuristic");
    expect(rec.requestId).toBeNull();
    expect(log).toHaveBeenCalledWith("warn", expect.stringMatching(/brand.recommend failed/));
  });

  it("sends approve/correct feedback keyed by the request id; no endpoint → honest distil sink", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const sink = new MubitBrandFeedbackSink({ apiKey: "k", baseURL: "https://api.mubit.ai/openai/v1", taskHeader: "X-Mubit-Task", embedModel: null, pricePerMInput: 0, pricePerMOutput: 0 }, "feedback", fetchImpl as unknown as typeof fetch);
    const r = await sink.send({ kind: "approval", task: "brand.recommend", requestId: "mreq_1", field: "primary", recommended: "#635bff", chosen: "#635bff", host: "a.com", reviewer: "user:1" });
    expect(r.delivered).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mubit.ai/openai/v1/feedback");
    expect(JSON.parse(String(init.body))).toMatchObject({ request_id: "mreq_1", task: "brand.recommend", verdict: "approve", corrected_output: { primary: { recommended: "#635bff" } } });
    expect(getBrandFeedbackSink({ MUBIT_API_KEY: "k" } as unknown as NodeJS.ProcessEnv).name).toBe("distil");
  });

  it("keeps the brand.recommend system prompt byte-identical", () => {
    expect(BRAND_RECOMMEND_SYSTEM_PROMPT).toMatchSnapshot();
  });
});
