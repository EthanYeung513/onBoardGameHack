"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { logoChip, type Theme } from "@/lib/brand/themes";
import "./themes.css";

// After the scan (D-34): the extracted identity as a few theme cards. One click applies the
// theme's tokens (brand.pickTheme) and opens the dashboard. No explanations, just the cards.

const font = (family: string) => `"${family}", -apple-system, "Segoe UI", sans-serif`;

function Preview({ theme, company }: { theme: Theme; company: string }) {
  const { primary, accent, surface, text } = theme.palette;
  const chip = logoChip(surface, theme.logoTone);
  const vars = { "--t-primary": primary, "--t-accent": accent, "--t-surface": surface, "--t-text": text, "--t-radius": theme.radius } as CSSProperties;
  return (
    <div className={`tp-preview tp-${theme.style}`} style={vars} aria-hidden>
      <div className="tp-bar">
        {theme.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored company logo (any host)
          <img src={theme.logoUrl} alt="" className={chip ? `chip-${chip}` : undefined} />
        ) : (
          <span className="tp-mark">{company.slice(0, 2).toUpperCase()}</span>
        )}
        <i />
        <i />
      </div>
      <div className="tp-hero" style={{ fontFamily: font(theme.headingFont) }}>
        Welcome aboard
      </div>
      <div className="tp-sub" style={{ fontFamily: font(theme.bodyFont) }}>
        Your first week at {company}
      </div>
      <div className="tp-row">
        <div className="tp-card">
          <b />
          <span />
          <span />
        </div>
        <div className="tp-card">
          <b className="acc" />
          <span />
          <span />
        </div>
      </div>
      <span className="tp-btn">Start</span>
    </div>
  );
}

export function ThemePick({ spaceId, company }: { spaceId: Id<"spaces">; company: string }) {
  const data = useQuery(api.brand.themes, { spaceId });
  const pick = useMutation(api.brand.pickTheme);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(themeId: string) {
    setBusy(themeId);
    setError(null);
    try {
      await pick({ spaceId, themeId });
      router.push(`/dashboard?space=${spaceId}`);
    } catch (err) {
      setError(err instanceof ConvexError ? (err.data as { message: string }).message : "Couldn't apply that theme. Please try again.");
      setBusy(null);
    }
  }

  // Profiles from before theme options existed: the Design tab still has every token.
  const none = data !== undefined && (!data || !data.themes.length);
  useEffect(() => {
    if (none) router.replace(`/editor?space=${spaceId}&panel=design`);
  }, [none, router, spaceId]);
  if (none) return null;

  return (
    <div className="theme-pick" id="step-themes">
      <div className="tag">Orthogonal / your brand</div>
      <h1>Pick your look.</h1>
      <div className="tp-grid">
        {(data?.themes ?? []).map((t) => (
          <button key={t.id} className={`tp-option${data?.themeId === t.id ? " on" : ""}`} onClick={() => void choose(t.id)} disabled={busy !== null} data-theme={t.id}>
            <Preview theme={t} company={company} />
            <span className="tp-name">
              {t.name}
              {t.recommended && <em>Recommended</em>}
              {busy === t.id && <span className="spin" />}
            </span>
          </button>
        ))}
        {!data && [0, 1, 2].map((i) => <div key={i} className="tp-option tp-skl" />)}
      </div>
      {error && <p className="tp-error">{error}</p>}
    </div>
  );
}
