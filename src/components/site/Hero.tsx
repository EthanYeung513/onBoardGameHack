import Image from "next/image";
import Link from "next/link";
import { HERO_COLUMNS, LINKS } from "./content";

export function Hero() {
  return (
    <section className="site-hero">
      <Image src="/landing/shape-hero.svg" alt="" width={1195} height={1175} className="site-hero-shape" priority unoptimized />
      <div className="site-hero-copy">
        <h1>Make onboarding fun!</h1>
        <div className="site-hero-side">
          <p>Fully game-based onboarding platform. AI-native. Agent-driven. Hyper-personalized to your company.</p>
          <div className="site-actions">
            <Link href={LINKS.build} className="site-btn site-btn-dark site-btn-hero site-btn-big">
              Build my onboarding
            </Link>
            <Link href={LINKS.demo} className="site-btn site-btn-outline-light site-btn-big">
              Try the demo scan
            </Link>
          </div>
        </div>
      </div>
      <div className="site-mosaic" aria-label="Orthogonal in pictures">
        {HERO_COLUMNS.map((col, i) => (
          <div key={i} className="site-mosaic-col">
            {col.map((t) => (
              <figure key={t.src} className={`site-tile site-tone-${t.tone}`}>
                {t.video ? (
                  <video src={t.video} poster={t.src} autoPlay muted loop playsInline aria-label={t.alt} />
                ) : (
                  <Image src={t.src} alt={t.alt} fill sizes="(max-width: 767px) 50vw, 20vw" unoptimized={t.src.endsWith(".svg")} />
                )}
              </figure>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
