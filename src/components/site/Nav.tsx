import Link from "next/link";
import { LINKS, NAV } from "./content";

export function Nav() {
  return (
    <header className="site-nav">
      <Link href="/" className="site-brand">
        Orthogonal
      </Link>
      <nav aria-label="Sections" className="site-nav-links">
        {NAV.map((n) => (
          <a key={n.href} href={n.href}>
            {n.label}
          </a>
        ))}
      </nav>
      <div className="site-nav-cta">
        <Link href={LINKS.login} className="site-btn site-btn-light">
          Log in
        </Link>
        <Link href={LINKS.build} className="site-btn site-btn-blue">
          Build my onboarding
        </Link>
      </div>
    </header>
  );
}
