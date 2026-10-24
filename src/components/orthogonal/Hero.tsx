"use client";

import { useEffect, useState, type FormEvent } from "react";
import { DEMO_SITE } from "@/lib/orthogonal/site";
import { Logo } from "./ui";

const PHRASES = ["Automate onboarding for your website.", "Keep track of changes on your website.", "Turn setup into something people finish."];

interface Props {
  url: string;
  onUrl: (url: string) => void;
  onScan: () => void;
  error: string | null;
}

export function Hero({ url, onUrl, onScan, error }: Props) {
  const [phrase, setPhrase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhrase((p) => (p + 1) % PHRASES.length), 2800);
    return () => clearInterval(t);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onScan();
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-carbon">
      <div aria-hidden className="absolute inset-0 bg-coral [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]" />
      <div aria-hidden className="absolute inset-0 bg-azure [clip-path:polygon(0_70%,100%_52%,100%_100%,0_100%)]" />
      <div aria-hidden className="absolute inset-0 bg-marigold [clip-path:polygon(0_88%,46%_80%,100%_94%,100%_100%,0_100%)]" />

      <div className="relative flex min-h-screen flex-col px-5 pt-7 md:px-11">
        <header className="flex items-center justify-between">
          <Logo size={20} />
          <nav className="flex items-center gap-2.5 text-sm text-white">
            <a href="#" className="rounded-lg border border-white/40 px-3.5 py-2 text-white hover:text-white">
              Docs
            </a>
            <a href="#" className="rounded-lg bg-white px-3.5 py-2 font-semibold text-carbon hover:text-carbon">
              Sign in
            </a>
          </nav>
        </header>

        <div className="grid items-center gap-10 pt-14 pb-9 text-white md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-h-[200px]" aria-live="polite">
            <h1
              key={phrase}
              className="m-0 max-w-[11ch] animate-[o-fade-up_.7s_ease_both] text-[clamp(44px,6.5vw,96px)] leading-none font-semibold tracking-[-.03em] text-balance"
            >
              {PHRASES[phrase]}
            </h1>
          </div>
          <p className="m-0 max-w-[400px] text-[clamp(18px,2vw,24px)] leading-[1.3] md:justify-self-end">
            A smart constructor that reads your website and builds a multi-step onboarding around it. Edit it. Ship it to GitHub.
          </p>
        </div>

        <div className="mb-14 flex justify-center">
          <form
            onSubmit={submit}
            className="w-[min(760px,100%)] animate-drift rounded-[20px] bg-[linear-gradient(120deg,#2D8CFF,#FFC72C,#FF5A3C,#2D8CFF)] bg-size-[300%_300%] p-[3px] shadow-[0_30px_80px_rgba(0,0,0,.35)]"
          >
            <div className="rounded-[17px] bg-carbon px-[22px] pt-[22px] pb-[18px] text-white">
              <label htmlFor="site-url" className="mb-2.5 block text-[13px] font-medium text-white/60">
                Start with your website
              </label>
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex h-14 min-w-[240px] flex-1 items-center gap-2 rounded-xl bg-white px-4 text-carbon">
                  <span className="text-[17px] text-black/40">https://</span>
                  <input
                    id="site-url"
                    value={url}
                    onChange={(e) => onUrl(e.target.value)}
                    placeholder={DEMO_SITE}
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    className="h-full min-w-0 flex-1 border-0 bg-transparent text-lg text-carbon outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="h-14 cursor-pointer rounded-xl bg-azure px-[26px] text-[17px] font-semibold text-white hover:bg-azure-deep"
                >
                  Scan my site →
                </button>
              </div>
              <p role={error ? "alert" : undefined} className={`mt-3.5 mb-0 text-[13px] ${error ? "text-coral" : "text-white/45"}`}>
                {error ?? "No sign-up to try. We read public pages only."}
              </p>
            </div>
          </form>
        </div>

        <HeroCards />
      </div>
    </div>
  );
}

const card = "flex min-h-[400px] flex-col gap-3.5 rounded-[18px] p-[22px] shadow-[0_24px_60px_rgba(0,0,0,.3)]";
const eyebrow = "text-[13px] font-semibold";
const title = "text-[22px] leading-[1.1] font-semibold tracking-[-.02em]";

/** The Scan / Build / Track / Ship teaser cards along the bottom of the hero. Marketing copy, not data. */
function HeroCards() {
  return (
    <div aria-hidden className="grid h-[340px] grid-cols-2 items-start gap-4 overflow-hidden sm:grid-cols-3 lg:grid-cols-5">
      <div className={`${card} mt-10 bg-white text-carbon`}>
        <div className={`${eyebrow} text-black/50`}>Scan</div>
        <div className={title}>Reads every public page.</div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
          <span className="rounded-lg bg-azure px-2.5 py-[7px] text-white">/pricing</span>
          <span className="rounded-lg bg-marigold px-2.5 py-[7px]">/docs</span>
          <span className="rounded-lg bg-coral px-2.5 py-[7px] text-white">/features</span>
          <span className="rounded-lg bg-black/6 px-2.5 py-[7px]">/changelog</span>
          <span className="rounded-lg bg-black/6 px-2.5 py-[7px]">+10</span>
        </div>
        <div className="mt-auto flex justify-between text-[13px] text-black/55">
          <span>Palette · type · copy</span>
          <span className="font-semibold text-carbon">14 pages</span>
        </div>
      </div>

      <div className={`${card} bg-coral text-white`}>
        <div className="text-[clamp(24px,2.2vw,32px)] leading-[1.05] font-semibold tracking-[-.02em]">&ldquo;Onboarding people actually finish.&rdquo;</div>
        <div className="mt-auto flex items-center justify-between">
          <span className="text-[13px] text-white/80">Gamified by default</span>
          <span className="rounded-full bg-white px-2.5 py-1.5 text-xs font-bold text-coral">+20 XP</span>
        </div>
      </div>

      <div className={`${card} mt-16 bg-azure text-white`}>
        <div className={`${eyebrow} text-white/75`}>Build</div>
        <div className="rounded-xl bg-white p-3.5 text-carbon">
          <div className="text-[11px] font-semibold tracking-[.05em] text-black/50 uppercase">Step 2 of 6</div>
          <div className="mt-1 text-base leading-[1.2] font-semibold">Which inverter do you have?</div>
          <div className="mt-2.5 flex gap-1.5">
            {[true, true, false, false].map((on, i) => (
              <span key={i} className={`h-2 flex-1 rounded ${on ? "bg-azure" : "bg-black/10"}`} />
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-white/18 px-3.5 py-3 text-sm font-semibold">Steps written from your own copy</div>
      </div>

      <div className={`${card} mt-4 bg-marigold text-carbon`}>
        <div className={`${eyebrow} text-black/55`}>Track</div>
        <div className={title}>Every change on your site, logged.</div>
        <div className="mt-1.5 flex flex-col gap-2 text-[13px]">
          <div className="flex justify-between rounded-[10px] bg-white px-3 py-[9px]">
            <span>Pricing tier renamed</span>
            <span className="text-black/50">2h</span>
          </div>
          <div className="flex justify-between rounded-[10px] bg-white px-3 py-[9px]">
            <span>New integration · Fronius</span>
            <span className="text-black/50">1d</span>
          </div>
          <div className="flex justify-between rounded-[10px] bg-black/8 px-3 py-[9px]">
            <span>Step 2 updated automatically</span>
            <span>↺</span>
          </div>
        </div>
      </div>

      <div className={`${card} mt-12 bg-blush text-carbon`}>
        <div className={`${eyebrow} text-black/55`}>Ship</div>
        <div className={title}>Push to your stack.</div>
        <div className="mt-1 flex flex-wrap gap-2 text-[13px] font-bold">
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-white">GH</span>
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-carbon text-white">▲</span>
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-[#3ECF8E] text-[#0F3D2E]">SB</span>
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-[#F6821F] text-white">CF</span>
        </div>
        <div className="mt-auto rounded-xl bg-white px-3.5 py-3">
          <div className="text-[11px] font-semibold text-black/50">Pull request</div>
          <div className="mt-0.5 text-[15px] font-semibold">orthogonal/onboarding</div>
        </div>
      </div>
    </div>
  );
}
