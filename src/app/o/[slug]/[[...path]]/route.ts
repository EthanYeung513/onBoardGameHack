import { fetchQuery } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { api } from "@convex/_generated/api";
import { readTemplate, TEMPLATE_FILES } from "@/lib/onboarding/bundle";
import { buildOnboardingContent, onboardingScript } from "@/lib/onboarding/content";

// Labelled deploy stand-in (D-33): when no Vercel token is configured, a published space's
// onboarding world is served here from the same template + content the Vercel deploy uses.
// Public on purpose — it is the link/QR the onboarding manager shares with hires.

const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path = [] } = await params;
  const file = path.length === 0 ? "index.html" : path.join("/");
  const type = TYPES[file.split(".").pop() ?? ""] ?? "text/plain";

  const published = await fetchQuery(api.deploy.published, { slug });
  if (!published) return new NextResponse("This onboarding world hasn't been published yet.", { status: 404 });

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
