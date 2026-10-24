import { completeJson } from "@/lib/llm/client";
import { dembrandtAvailable, htmlCssEvidence, runDembrandt, summariseDembrandt } from "@/lib/design/evidence";
import { DESIGN_SYSTEM_PROMPT } from "@/lib/prompts";
import { DesignTokens } from "@/lib/schemas/tokens";
import { screenshotBlocks } from "../media";
import type { StageDefinition } from "../types";

export const extractDesignStage: StageDefinition = {
  name: "extract_design",
  label: "Extract design",
  description: "Read colours, typography, radii and logo from the site",
  maxAttempts: 3,
  async run(ctx) {
    const { db, project } = ctx;
    const existing = await db.from("design_tokens").select("version").eq("project_id", project.id).order("version", { ascending: false }).limit(1);
    if (existing.data?.length) return { done: true, summary: "tokens already extracted" };

    let source: "dembrandt" | "html_css" = "html_css";
    let evidence: Record<string, unknown>;
    if (dembrandtAvailable()) {
      await ctx.event("info", "Running dembrandt against the homepage");
      try {
        evidence = summariseDembrandt(await runDembrandt(project.url));
        source = "dembrandt";
        await ctx.progress(0.5);
      } catch (err) {
        await ctx.event("warn", `dembrandt failed, using the HTML and CSS fallback: ${(err as Error).message}`);
        evidence = await htmlCssEvidence(project.url);
      }
    } else {
      await ctx.event("info", "dembrandt needs a local browser, so tokens come from the HTML and CSS plus a screenshot");
      evidence = await htmlCssEvidence(project.url);
    }
    await ctx.event("info", `Collected brand evidence via ${source}`, { colors: (evidence.palette ?? evidence.colors) as unknown[] });

    const shots = await screenshotBlocks(db, project.id, 1);
    const { data, route } = await completeJson(
      DesignTokens,
      {
        max_tokens: 4000,
        system: DESIGN_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              ...shots.blocks,
              { type: "text", text: `Site: ${project.url}\nEvidence source: ${source}\n\nEvidence JSON:\n${JSON.stringify(evidence, null, 1).slice(0, 24_000)}` },
            ],
          },
        ],
      },
      { projectId: project.id, task: "extract_design", log: (l, m, d) => ctx.event(l, m, d) },
    );
    const ins = await db.from("design_tokens").insert({ project_id: project.id, version: 1, tokens_json: data, source: `${source}+model` });
    if (ins.error) throw new Error(ins.error.message);
    if (data.logo.url) {
      await db.from("assets").upsert({ project_id: project.id, kind: "logo", source_url: data.logo.url, meta: { alt: data.logo.alt } }, { onConflict: "project_id,kind,source_url" });
    }
    return { done: true, summary: `primary ${data.colors.primary}, ${data.typography.headingFont.split(",")[0]} headings (${source}, ${route})` };
  },
};
