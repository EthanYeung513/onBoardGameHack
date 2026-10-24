import { StageTrack } from "@/components/gen/shell/StageTrack";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="mx-auto grid min-h-screen max-w-5xl items-center gap-12 px-6 py-12 md:grid-cols-[1.2fr_1fr]">
      <section className="space-y-8">
        <h1 className="text-4xl font-bold md:text-5xl">Paste a website. Get onboarding that looks like it belongs there.</h1>
        <p className="g-muted max-w-prose text-lg">
          The studio reads a company&apos;s site, learns its product and brand, asks you a few questions, then builds three playable onboarding flows you can edit by chat.
        </p>
        <div className="g-panel p-5">
          <StageTrack states={{ crawl: "done", extract_design: "done", analyse: "done", awaiting_confirmation: "active" }} />
        </div>
      </section>
      <section className="g-panel p-6 md:p-8">
        <h2 className="mb-1 text-2xl font-bold">Sign in</h2>
        <p className="g-muted mb-6 text-sm">Access is limited to the team.</p>
        {error && <p className="mb-4 text-sm" style={{ color: "var(--g-danger)" }}>{error}</p>}
        <LoginForm next={next ?? "/"} />
      </section>
    </main>
  );
}
