import Image from "next/image";
import Link from "next/link";
import { FEATURE_SHOTS, FEATURES, LINKS, STEPS } from "./content";

/** "Orthogonal in motion": the product film, linked out (no embedded player script). */
export function Motion() {
  return (
    <section id="about" className="site-section site-bg-green">
      <div className="site-container">
        <h2 className="site-h2 site-h2-narrow">Orthogonal in motion</h2>
        <a href={LINKS.video} target="_blank" rel="noreferrer" className="site-video" aria-label="Watch the Orthogonal film on YouTube">
          <Image src="/landing/motion-cover.png" alt="" fill sizes="(max-width: 1260px) 92vw, 1080px" />
          <span className="site-play" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          </span>
        </a>
      </div>
    </section>
  );
}

export function Why() {
  return (
    <section className="site-section">
      <div className="site-container site-split">
        <div className="site-sticky">
          <h2 className="site-h2">Why Orthogonal</h2>
          <p className="site-lead">
            As AI reshapes how we work, learning must be continuous. Orthogonal turns your company&apos;s tribal knowledge into a playable world, built to keep new
            hires learning, earning and improving over time.
          </p>
          <Link href={LINKS.build} className="site-btn site-btn-outline">
            Build my onboarding
          </Link>
        </div>
        <figure className="site-why-media">
          <div className="site-why-frame">
            <video src="/landing/why-world.mp4" poster="/landing/why-world.jpg" autoPlay muted loop playsInline aria-label="A new hire exploring an Orthogonal room" />
          </div>
          <figcaption>Trust the fun!</figcaption>
        </figure>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="site-section site-bg-gray">
      <div className="site-container">
        <div className="site-split site-head">
          <h2 className="site-h2">Easy to try. Built to scale.</h2>
          <p className="site-lead">From stack to world. Instantly. From onboarding to earning. Continuously.</p>
        </div>
        <ol className="site-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="site-step">
              <div className="site-step-media">
                <Image src={s.img} alt={s.alt} fill sizes="(max-width: 767px) 92vw, (max-width: 1100px) 46vw, 30vw" />
              </div>
              <div className="site-step-body">
                <span className={`site-chip site-chip-${s.actor.toLowerCase()}`}>{s.actor}</span>
                <h3>
                  {i + 1}. {s.title}
                </h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden className="site-check">
      <circle cx="20" cy="20" r="19" fill="var(--site-green)" stroke="var(--site-ink)" strokeWidth="1" />
      <path d="M12.5 20.5l5 5 10-11" fill="none" stroke="var(--site-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Features() {
  return (
    <section id="features" className="site-section">
      <div className="site-container">
        <div className="site-split site-head">
          <h2 className="site-h2">Agent-driven features</h2>
          <p className="site-lead">Easy to manage. Fun to onboard.</p>
        </div>
        <div className="site-split">
          <ul className="site-features">
            {FEATURES.map((f) => (
              <li key={f}>
                <Check />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <div className="site-shots">
            {FEATURE_SHOTS.map((s) => (
              <figure key={s.src} className="site-shot">
                <div className="site-shot-media">
                  <Image src={s.src} alt={s.alt} fill sizes="(max-width: 767px) 30vw, 15vw" />
                </div>
                <figcaption>{s.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
        <div className="site-split site-stat">
          <div>
            <p className="site-stat-num">
              60<span>%</span>
            </p>
            <p>Employees engage more with gamified training*</p>
          </div>
          <div>
            <p className="site-lead">Research shows employees engage more with gamified training, with 60% preferring it over traditional methods.</p>
            <p className="site-small">*Study: Hamari, Koivisto, &amp; Sarsa (2014)</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Cta() {
  return (
    <section id="start" className="site-section site-bg-blue">
      <div className="site-container site-split">
        <div>
          <p className="site-eyebrow">Trust the fun!</p>
          <h2 className="site-h1">Build your world</h2>
        </div>
        <div className="site-cta-side">
          <p className="site-lead">
            Paste your company website. Orthogonal reads it, learns your brand and drafts the first courses — then you edit, invite hires and watch them play.
          </p>
          <div className="site-actions">
            <Link href={LINKS.build} className="site-btn site-btn-dark site-btn-big">
              Build my onboarding
            </Link>
            <Link href={LINKS.demo} className="site-btn site-btn-outline site-btn-big">
              Try the demo scan
            </Link>
          </div>
          <p className="site-small">
            Already have a space? <Link href={LINKS.login}>Log in</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
