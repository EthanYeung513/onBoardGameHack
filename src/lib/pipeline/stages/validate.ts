import { validateFlowSpec } from "@/lib/flow/spec";
import { exportFiles } from "@/lib/flow/export";
import { DesignTokens } from "@/lib/schemas/tokens";
import type { StageDefinition } from "../types";

export const validateStage: StageDefinition = {
  name: "validate",
  label: "Validate",
  description: "Check every flow and export its files",
  maxAttempts: 2,
  async run(ctx) {
    const { db, project } = ctx;
    const tokensRow = await db.from("design_tokens").select("tokens_json").eq("project_id", project.id).order("version", { ascending: false }).limit(1).single();
    if (tokensRow.error) throw new Error(tokensRow.error.message);
    const tokens = DesignTokens.parse(tokensRow.data.tokens_json);
    const flows = await db.from("flows").select("id, variant_key, version, spec_json, status").eq("project_id", project.id).eq("version", 1);
    if (flows.error) throw new Error(flows.error.message);
    let valid = 0;
    for (const f of flows.data ?? []) {
      const r = validateFlowSpec(f.spec_json);
      if (!r.ok) {
        await db.from("flows").update({ status: "invalid" }).eq("id", f.id);
        await ctx.event("error", `${f.variant_key} failed validation: ${r.errors.slice(0, 3).join("; ")}`);
        continue;
      }
      const files = exportFiles(r.spec, tokens);
      const up = await db.from("generated_files").upsert(
        files.map((file) => ({ project_id: project.id, flow_id: f.id, path: file.path, content: file.content, version: f.version })),
        { onConflict: "flow_id,path" },
      );
      if (up.error) throw new Error(up.error.message);
      await db.from("flows").update({ status: "valid" }).eq("id", f.id);
      valid++;
      await ctx.event("info", `${f.variant_key} valid, exported ${files.map((x) => x.path).join(", ")}`);
    }
    if (valid === 0) throw new Error("No flow passed validation");
    return { done: true, summary: `${valid} of ${flows.data?.length ?? 0} flows valid` };
  },
};
