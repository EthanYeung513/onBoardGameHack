import { useEffect, useRef } from 'react';
import { COMPANY } from '../config';
import { renderLogo } from '../logo';

// Company name drawn in the Stardew logo style (src/logo.ts), scaled by an
// integer factor (when there's room) so the pixel art stays crisp.
function Logo({ name }: { name: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let art: HTMLCanvasElement | null = null;
    const fit = () => {
      if (!art) return;
      const fitS = Math.min(innerWidth * 0.92 / art.width, innerHeight * 0.42 / art.height);
      // integer steps keep pixels even; below 2x (phones/portrait) use the exact fit
      const s = fitS >= 2 ? Math.floor(fitS) : Math.max(0.5, fitS);
      art.style.width = `${art.width * s}px`;
      art.style.height = `${art.height * s}px`;
    };
    renderLogo(name).then(c => {
      if (!live || !host.current) return;
      art = c;
      art.className = 'title-logo-art';
      host.current.replaceChildren(art);
      fit();
    });
    addEventListener('resize', fit);
    return () => { live = false; removeEventListener('resize', fit); };
  }, [name]);
  return <div ref={host} className="title-logo" role="img" aria-label={name} />;
}

export default function Title({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="title-screen">
      <Logo name={COMPANY.name} />
      {COMPANY.logoUrl && (
        <div className="sd-panel title-card">
          <img src={COMPANY.logoUrl} alt={`${COMPANY.name} logo`} onError={e => { (e.currentTarget.parentElement as HTMLElement).hidden = true; }} />
        </div>
      )}
      <div className="title-tag">{COMPANY.tagline}</div>
      <button className="sd-btn title-play" onClick={onPlay} autoFocus>
        ▶&nbsp; Play
      </button>
      <div className="title-credit">new-hire world · day one</div>
    </div>
  );
}
