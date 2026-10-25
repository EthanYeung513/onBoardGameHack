import { readFileSync } from "node:fs";
import path from "node:path";
import { onboardingScript, type OnboardingContent } from "./content";

// The deployable artifact: the mockup world (templates/onboarding) + the generated onboarding.js.

export const TEMPLATE_DIR = path.join(process.cwd(), "templates", "onboarding");
export const TEMPLATE_FILES = ["index.html", "styles.css", "state.js", "game.js"] as const;

export function readTemplate(file: string): string {
  if (!(TEMPLATE_FILES as readonly string[]).includes(file)) throw new Error(`Not a template file: ${file}`);
  return readFileSync(path.join(TEMPLATE_DIR, file), "utf8");
}

export function buildBundle(content: OnboardingContent, mode: "vercel" | "stand-in", now = new Date()) {
  const files: { file: string; data: string }[] = TEMPLATE_FILES.map((file) => ({ file, data: readTemplate(file) }));
  files.push({ file: "onboarding.js", data: onboardingScript(content, { generatedAt: now.toISOString(), mode }) });
  return files;
}
