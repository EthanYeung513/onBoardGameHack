import { completeJson } from "@/lib/llm/client";
import { ANALYSE_SYSTEM_PROMPT } from "@/lib/prompts";
import { ProjectModel } from "@/lib/schemas/project-model";
import { screenshotBlocks } from "../media";
import type { StageDefinition } from "../types";

const PAGE_CHARS = 7000;
const TOTAL_CHARS = 70_000;

export const analyseStage: StageDefinition = {
  name: "analyse",
  label: "Analyse",
  description: "Build the project model from pages, screenshots and tokens",
  maxAttempts: 3,
  async run(ctx) {
    const { db, project } = ctx;
    const existing = await db.from("project_models").select("version").eq("project_id", project.id).limit(1);
    if (existing.data?.length) return { done: true, summary: "model already built" };

    const pages = await db.from("crawl_pages").select("url, title, page_type, markdown").eq("project_id", project.id).eq("status", "fetched").gte("word_count", 20).order("rank_score", { ascending: false });
    if (pages.error) throw new Error(pages.error.message);
    if (!pages.data?.length) throw new Error("No pages were fetched, so there is nothing to analyse");
    const tokens = await db.from("design_tokens").select("tokens_json").eq("project_id", project.id).order("version", { ascending: false }).limit(1).maybeSingle();

    let budget = TOTAL_CHARS;
    const parts: string[] = [];
    for (const p of pages.data) {
      if (budget <= 500) break;
      const body = (p.markdown ?? "").slice(0, Math.min(PAGE_CHARS, budget));
      budget -= body.length;
      parts.push(`<page url="${p.url}" type="${p.page_type}" title="${(p.title ?? "").replace(/"/g, "'")}">\n${body}\n</page>`);
    }
    const allowed = new Set(pages.data.map((p) => p.url));
    const shots = await screenshotBlocks(db, project.id, 3);
    await ctx.event("info", `Sending ${parts.length} pages and ${shots.blocks.length} screenshots for analysis`);

    const { data, route, attempts } = await completeJson(
      ProjectModel,
      {
        max_tokens: 8000,
        system: ANALYSE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              ...shots.blocks,
              {
                type: "text",
                text: `Website: ${project.url}\nScreenshots above are of: ${shots.urls.join(", ") || "none"}\n\nDesign tokens:\n${JSON.stringify(tokens.data?.tokens_json ?? {}, null, 1)}\n\nAllowed source URLs:\n${[...allowed].join("\n")}\n\nPages:\n${parts.join("\n\n")}`,
              },
            ],
          },
        ],
      },
      {
        projectId: project.id,
        task: "analyse",
        log: (l, m, d) => ctx.event(l, m, d),
        validate: (m) =>
          m.features.flatMap((f, i) => f.sourceUrls.filter((u) => !allowed.has(u)).map((u) => `features.${i}.sourceUrls: ${u} is not one of the crawled pages`)),
      },
    );
    const ins = await db.from("project_models").insert({ project_id: project.id, version: 1, model_json: data });
    if (ins.error) throw new Error(ins.error.message);
    if (data.companyName) await db.from("projects").update({ name: data.companyName }).eq("id", project.id);
    return { done: true, summary: `${data.features.length} features, ${data.targetAudience.length} audiences (${route}, ${attempts} attempt${attempts > 1 ? "s" : ""})` };
  },
};
