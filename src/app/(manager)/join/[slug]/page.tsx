import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api } from "@convex/_generated/api";
import { Logo } from "@/components/manager/Logo";
import { brandVars, initials } from "@/components/manager/brand";
import { Icon } from "@/components/manager/icons";

// `/join/<slug>`: the plain shareable page for a space's new hires (QR-code friendly). Public —
// it only shows the space's brand and its course titles; the course cards follow dashboard.html's
// course-card shape. Courses not yet published say so instead of pretending to be playable.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return undefined;
  return await fetchQuery(api.join.bySlug, { slug });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).slug).catch(() => null);
  return { title: data ? `Join ${data.name} · Orthogonal` : "Join · Orthogonal" };
}

export default async function JoinPage({ params }: Params) {
  const { slug } = await params;
  const data = await load(slug);
  if (data === undefined) return <p style={{ padding: 40 }}>This onboarding space isn&apos;t available right now (backend not configured).</p>;
  if (!data) notFound();
  const live = data.courses.filter((c) => c.live).length;

  return (
    <main style={{ ...brandVars(data.brand), maxWidth: 880, margin: "0 auto", padding: "48px 24px 64px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
        <span
          style={{ width: 40, height: 40, borderRadius: 10, background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}
        >
          {initials(data.name)}
        </span>
        <div>
          <div style={{ fontWeight: 600 }}>{data.name}</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{data.host}</div>
        </div>
      </div>

      <h1 style={{ fontSize: 40, letterSpacing: "-0.02em", marginBottom: 10 }}>Welcome to {data.name}</h1>
      <p style={{ color: "var(--muted)", fontSize: 16, marginBottom: 24 }}>Your onboarding, built from how {data.name} actually works.</p>
      <a className="btn btn-primary" href="#courses">
        Start onboarding
      </a>

      <h2 id="courses" style={{ fontSize: 20, margin: "44px 0 16px" }}>
        Your courses
      </h2>
      {data.courses.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No courses yet.</p>
      ) : (
        <div className="grid2">
          {data.courses.map((c) => (
            <div key={c.id} className="course-card">
              <div className="ci" style={{ color: "var(--brand)" }}>
                <Icon name={c.icon} size={30} />
              </div>
              <h4>{c.title}</h4>
              <div className="cb">
                <Icon name="building" size={13} /> {c.building} · {c.game} game
              </div>
              {c.desc && <p>{c.desc}</p>}
              <span className={`pill ${c.live ? "live" : "inv"}`} style={{ alignSelf: "flex-start" }}>
                {c.live ? "Live" : "Coming soon"}
              </span>
            </div>
          ))}
        </div>
      )}
      {data.courses.length > 0 && live === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 16 }}>Courses open here as soon as your manager publishes them.</p>
      )}

      <div style={{ marginTop: 56, fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
        Powered by <Logo size={16} />
      </div>
    </main>
  );
}
