import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fetchQuery } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { api } from "@convex/_generated/api";
import { readTemplate, TEMPLATE_FILES } from "@/lib/onboarding/bundle";
import { buildOnboardingContent, onboardingScript } from "@/lib/onboarding/content";
import { buildWorld } from "@/lib/world/build";
import { worldHtml } from "@/lib/world/html";

// The hire's link (D-33, D-35): a published space's onboarding world. Public on purpose: it is
// the link/QR the manager shares. When the prebuilt Stardew-style world exists (public/world,
// `npm run build:world`), it is served with this space's world.json inlined, built from the live
// courses and brain on every request, so the world follows the company as it changes. Otherwise
// the earlier mockup world (templates/onboarding) is served, so the link always works.

const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8" };
const WORLD_INDEX = path.join(process.cwd(), "public", "world", "index.html");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path: parts = [] } = await params;
  const file = parts.length === 0 ? "index.html" : parts.join("/");
  const type = TYPES[file.split(".").pop() ?? ""] ?? "text/plain";

  const published = await fetchQuery(api.deploy.published, { slug });
  if (!published) return new NextResponse("This onboarding world hasn't been published yet.", { status: 404 });

  if (file === "world.json" || (file === "index.html" && existsSync(WORLD_INDEX))) {
    const world = buildWorld({ ...published.input, generatedAt: published.deployedAt });
    if (file === "world.json") return NextResponse.json(world, { headers: { "cache-control": "no-store" } });
    return new NextResponse(worldHtml(readFileSync(WORLD_INDEX, "utf8"), world, "/world/"), { headers: { "content-type": TYPES.html, "cache-control": "no-store" } });
  }

  if (file === "onboarding.js") {
    const content = buildOnboardingContent(published.input);
    const body = onboardingScript(content, { generatedAt: new Date(published.deployedAt).toISOString(), mode: "stand-in" });
    return new NextResponse(body, { headers: { "content-type": type, "cache-control": "no-store" } });
  }
  if (!(TEMPLATE_FILES as readonly string[]).includes(file)) return new NextResponse("Not found", { status: 404 });
  // Next drops trailing slashes, so the world's relative asset URLs resolve through a <base>.
  const body = file === "index.html" ? readTemplate(file).replace("<head>", `<head>\n<base href="/o/${encodeURIComponent(slug)}/">`) : readTemplate(file);
  return new NextResponse(body, { headers: { "content-type": type, "cache-control": file === "index.html" ? "no-store" : "public, max-age=300" } });
}
