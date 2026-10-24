import Link from "next/link";
import { LINKS } from "./content";

/** The Orthogonal shape strip from the original footer animation, drawn as a static SVG. */
function Shapes() {
  const slash = (x: number) => `${x},0 ${x + 127},0 ${x + 360},233 ${x + 360},360 ${x + 233},360 ${x},127`;
  return (
    <svg viewBox="0 0 1440 360" className="site-shapes" aria-hidden preserveAspectRatio="xMidYMid meet">
      {[89, 270].flatMap((cx) => [89, 270].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={89} fill="var(--site-red)" />))}
      <polygon points={slash(360)} fill="var(--site-blue-deep)" />
      <circle cx={900} cy={180} r={111.5} fill="none" stroke="var(--site-yellow)" strokeWidth={137} />
      <polygon points={slash(1080)} fill="var(--site-blue-deep)" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-row">
        <span>Orthogonal</span>
        <nav aria-label="Footer">
          <a href="#about">About</a>
          <a href="#how-it-works">How it works</a>
          <Link href={LINKS.login}>Log in</Link>
          <Link href="/classic">Classic page</Link>
        </nav>
      </div>
      <Shapes />
      <div className="site-footer-row site-footer-legal">
        <span>© Orthogonal Labs</span>
      </div>
    </footer>
  );
}
