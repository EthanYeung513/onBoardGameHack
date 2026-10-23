import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultLevels, type WorldSpec } from "../../content/acme-pay/world";
import type { Rubric } from "../db/schema";
import { chunkMarkdown } from "../lib/chunk";
import type { GradeInput } from "../tasks/grade";

/**
 * One held-out answer labelled by a manager. These never go through the review queue or into training, so
 * agreement on them is an honest measure of each grader version.
 */
export const heldOutItemSchema = z.object({
  id: z.string().min(1),
  /** The start of the card's prompt, which identifies the scenario in the world spec. */
  card: z.string().min(5),
  answer: z.string().min(1),
  human: z.number().int().min(0).max(3),
  labeller: z.string().min(1),
});
export const heldOutSetSchema = z.array(heldOutItemSchema).min(1);
export type HeldOutItem = z.infer<typeof heldOutItemSchema>;

export interface ResolvedItem extends HeldOutItem {
  input: GradeInput;
}

export const HELD_OUT_PATH = path.join("eval", "heldout.json");
export const EXAMPLE_PATH = path.join("eval", "heldout.example.json");

/** Loads the real held-out set, or the example set (with `isExample`) until the manager's labels exist. */
export function loadHeldOut(root = process.cwd(), file?: string): { items: HeldOutItem[]; source: string; isExample: boolean } {
  const chosen = file ?? (existsSync(path.join(root, HELD_OUT_PATH)) ? HELD_OUT_PATH : EXAMPLE_PATH);
  const items = heldOutSetSchema.parse(JSON.parse(readFileSync(path.join(root, chosen), "utf8")));
  return { items, source: chosen, isExample: chosen === EXAMPLE_PATH };
}

/** Builds each item's grader input from the world spec and handbook, so evals don't depend on database state. */
export function resolveItems(items: HeldOutItem[], world: WorldSpec, contentDir: string): ResolvedItem[] {
  return items.map((item) => {
    for (const pack of world.packs) {
      const card = pack.cards.find((c) => c.prompt.startsWith(item.card));
      if (!card) continue;
      if (card.type !== "free_text" && card.type !== "incident") throw new Error(`Held-out item ${item.id} points at a ${card.type} card`);
      const doc = pack.docs.find((d) => d.slug === card.source.doc);
      if (!doc) throw new Error(`Held-out item ${item.id}: doc ${card.source.doc} not in pack ${pack.slug}`);
      const chunk = chunkMarkdown(readFileSync(path.join(contentDir, doc.file), "utf8")).find((c) => c.heading === card.source.heading);
      if (!chunk) throw new Error(`Held-out item ${item.id}: section ${card.source.heading} not found`);
      const rubric: Rubric = {
        competency: card.competency,
        policy: chunk.text,
        levels: card.rubric?.levels ?? defaultLevels,
        signals: card.rubric?.signals,
        redFlags: card.rubric?.redFlags,
      };
      return { ...item, input: { packTitle: pack.title, role: pack.role ?? "Everyone", scenario: card.prompt, rubric, answer: item.answer, corrections: [] } };
    }
    throw new Error(`Held-out item ${item.id}: no card starts with "${item.card}"`);
  });
}
