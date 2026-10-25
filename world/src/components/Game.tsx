import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { TownScene } from '../game/TownScene';
import { bus, input } from '../game/bridge';
import { COMPANY, COURSES, SHOP_NAME, WORLD, type Course, type Npc } from '../config';
import {
  awardCompleted, courseReward, getCredits, onCredits, ownedCount, recordResult, redeem, shopItems, soldOut,
  type Icon, type ShopItem,
} from '../economy';
import { reportResult } from '../hireSync';
import Coin from './Coin';
import CourseGame from './CourseGame';
import type { Hire } from '../App';
import { weatherFor } from '../weather';

function Joystick() {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!, knob = stick.current!;
    let pid: number | null = null;
    const set = (dx: number, dy: number) => {
      knob.style.transform = `translate(calc(-50% + ${dx * 32}px), calc(-50% + ${dy * 32}px))`;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      const r = el.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      input.x = dx; input.y = dy; set(dx, dy);
    };
    const down = (e: PointerEvent) => { pid = e.pointerId; el.setPointerCapture(pid); move(e); };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null; input.x = 0; input.y = 0; set(0, 0);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);
  return <div ref={ref} className="joystick"><div ref={stick} className="stick" /></div>;
}

function NpcDialog({ npc, onClose }: { npc: Npc; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const last = idx >= npc.facts.length;
  return (
    <div className="dialog-wrap">
      <div className="sd-panel dialog">
        <img src="assets/portraits.png" style={{ objectFit: 'none', objectPosition: `-${npc.sprite * 64}px 0`, width: 64, height: 64 }} alt={npc.name} />
        <div style={{ flex: 1 }}>
          <span className="d-name">{npc.name}</span>
          <span className="d-role">{npc.role} · {COMPANY.name}</span>
          <span className="d-text">{last ? "Come find me if you need anything. Have a great first day!" : npc.facts[idx]}</span>
        </div>
        <button className="sd-btn small d-next" onClick={() => last ? onClose() : setIdx(idx + 1)}>
          {last ? 'Done' : 'More ›'}
        </button>
      </div>
    </div>
  );
}

function CourseMenu({ course, onStart, onClose }: { course: Course; onStart: () => void; onClose: () => void }) {
  const [view, setView] = useState<'menu' | 'progress'>('menu');
  const done = course.completion >= 100;
  return (
    <div className="menu-overlay" onClick={onClose}>
      <div className="sd-panel menu-card" onClick={e => e.stopPropagation()}>
        <h2>{course.name}</h2>
        <p className="m-sub">{COMPANY.name} · course</p>
        {course.desc && <p className="m-desc">{course.desc}</p>}
        {!!course.staleSteps && <p className="m-stale">Updated content: {course.staleSteps} step{course.staleSteps === 1 ? '' : 's'} refreshed</p>}
        <p className="m-reward">
          {done ? 'Completed · earned' : 'Reward on completion:'} <Coin size={18} /> {courseReward(course)}
        </p>
        {view === 'menu' ? (
          <>
            <button className="sd-btn" onClick={() => setView('progress')}>View Progress</button>
            <button className="sd-btn" onClick={onStart} autoFocus>{course.completion > 0 ? 'Continue Course' : 'Start Course'}</button>
            <button className="sd-btn" onClick={onClose}>Leave</button>
          </>
        ) : (
          <>
            <div className="menu-prog">Completion: {course.completion}%</div>
            <div className="sd-bar"><i style={{ width: `${course.completion}%` }} /></div>
            <button className="sd-btn" onClick={() => setView('menu')} style={{ marginTop: 16 }}>Back</button>
          </>
        )}
      </div>
    </div>
  );
}

/** A sprite crop from one of the public/assets sheets, scaled to fit `box` px. */
function SpriteIcon({ icon, box = 48 }: { icon: Icon; box?: number }) {
  const [x, y, w, h] = icon.rect;
  const s = Math.max(1, Math.floor(box / Math.max(w, h)));
  return (
    <div className="sprite-icon" style={{ width: box, height: box }}>
      <div style={{
        width: w, height: h, transform: `scale(${s})`,
        background: `url(assets/${icon.sheet}.png) -${x}px -${y}px`,
      }} />
    </div>
  );
}

function ShopMenu({ credits, onClose }: { credits: number; onClose: () => void }) {
  const [step, setStep] = useState<{ kind: 'list' } | { kind: 'confirm' | 'done'; item: ShopItem }>({ kind: 'list' });
  return (
    <div className="menu-overlay" onClick={onClose}>
      <div className="sd-panel menu-card shop-card" onClick={e => e.stopPropagation()}>
        <h2>{SHOP_NAME}</h2>
        <p className="m-sub">Spend the credits you earn finishing courses</p>
        <div className="shop-balance">Your balance: <Coin size={20} /> <b>{credits}</b></div>
        {step.kind === 'list' && (
          <>
            <div className="shop-grid">
              {shopItems().map(it => {
                const out = soldOut(it), short = it.cost - credits, owned = ownedCount(it.id);
                return (
                  <div key={it.id} className={`shop-item${out || short > 0 ? ' dim' : ''}`}>
                    <SpriteIcon icon={it.icon} />
                    <div className="si-body">
                      <span className="si-name">{it.name}</span>
                      {it.blurb && <span className="si-blurb">{it.blurb}</span>}
                      <span className="si-cost"><Coin size={16} /> {it.cost}{owned > 0 && !out ? ` · owned ×${owned}` : ''}</span>
                    </div>
                    <button className="sd-btn small" disabled={out || short > 0}
                      onClick={() => setStep({ kind: 'confirm', item: it })}>
                      {out ? 'Owned' : short > 0 ? `Need ${short}` : 'Buy'}
                    </button>
                  </div>
                );
              })}
            </div>
            <button className="sd-btn" onClick={onClose}>Leave</button>
          </>
        )}
        {step.kind === 'confirm' && (
          <div className="shop-step">
            <SpriteIcon icon={step.item.icon} box={64} />
            <p>Redeem <b>{step.item.name}</b> for <Coin size={16} /> {step.item.cost}?</p>
            <button className="sd-btn" onClick={() => redeem(step.item) ? setStep({ kind: 'done', item: step.item }) : setStep({ kind: 'list' })}>Redeem</button>
            <button className="sd-btn" onClick={() => setStep({ kind: 'list' })}>Cancel</button>
          </div>
        )}
        {step.kind === 'done' && (
          <div className="shop-step">
            <SpriteIcon icon={step.item.icon} box={64} />
            <p><b>{step.item.name}</b> redeemed!</p>
            <p className="m-sub">The People team will get it to you this week.</p>
            <button className="sd-btn" onClick={() => setStep({ kind: 'list' })}>Back to Shop</button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatUpdated(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

type Hover = { course: Course | null; shop?: boolean; x: number; y: number };

/** Info card pinned above a building's top-centre (screen px from TownScene),
 *  measured and kept inside the viewport — tall buildings near the top edge
 *  would otherwise push it off-screen. */
function BuildingTip({ hover }: { hover: Hover }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const d = el.current;
    if (!d) return;
    const m = 8, w = d.offsetWidth, h = d.offsetHeight;
    const left = Math.min(Math.max(hover.x - w / 2, m), window.innerWidth - w - m);
    const top = Math.min(Math.max(hover.y - h - 6, m), window.innerHeight - h - m);
    d.style.left = `${left}px`;
    d.style.top = `${top}px`;
    d.style.visibility = 'visible';
  });
  return (
    <div ref={el} className="tooltip" style={{ visibility: 'hidden' }}>
      {hover.course ? (
        <>
          <span className="t-name">{hover.course.name}</span>
          <div className="sd-bar"><i style={{ width: `${hover.course.completion}%` }} /></div>
          <span className="t-pct">{hover.course.completion}% complete · <Coin size={12} /> {courseReward(hover.course)}</span>
        </>
      ) : (
        <>
          <span className="t-name">{SHOP_NAME}</span>
          <span className="t-pct">Redeem your credits for rewards</span>
        </>
      )}
    </div>
  );
}

export default function Game({ hire, charRow }: { hire: Hire; charRow: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Npc | null>(null);
  const [menu, setMenu] = useState<Course | null>(null);
  const [shop, setShop] = useState(false);
  const [playing, setPlaying] = useState<Course | null>(null);
  // The last building left mid-run: its game stays mounted (paused, hidden) so Continue resumes it.
  const [parked, setParked] = useState<Course | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [credits, setCredits] = useState(getCredits);
  const [popups, setPopups] = useState<{ id: number; delta: number; delay: number }[]>([]);

  // credits: live balance + floating "+50" chips; pay out courses already complete
  useEffect(() => {
    let seq = 0, timers: number[] = [];
    const off = onCredits(e => {
      setCredits(e.balance);
      if (e.delta <= 0) return;
      const id = ++seq;
      setPopups(ps => {
        const delay = ps.length * 450; // stack several payouts one after another
        timers.push(window.setTimeout(() => setPopups(q => q.filter(p => p.id !== id)), delay + 2200));
        return [...ps, { id, delta: e.delta, delay }];
      });
    });
    const t = window.setTimeout(() => awardCompleted(COURSES), 900); // after the world fades in
    return () => { off(); clearTimeout(t); timers.forEach(clearTimeout); timers = []; };
  }, []);

  useEffect(() => {
    const onHover = (d: { course: Course | null; shop?: boolean; x: number; y: number }) =>
      setHover(d.course || d.shop ? d : null);
    const onShop = () => { setShop(true); bus.emit('ui-open'); };
    const onEnter = (d: { course: Course }) => { setMenu(d.course); bus.emit('ui-open'); };
    const onNpc = (d: { npc: Npc }) => { setDialog(d.npc); bus.emit('ui-open'); };
    const onHint = (d: { text: string | null }) => setHint(prev => prev === d.text ? prev : d.text);
    bus.on('hover-building', onHover);
    bus.on('enter-building', onEnter);
    bus.on('npc-dialog', onNpc);
    bus.on('hint', onHint);
    bus.on('enter-shop', onShop);
    return () => {
      bus.off('enter-shop', onShop);
      bus.off('hover-building', onHover);
      bus.off('enter-building', onEnter);
      bus.off('npc-dialog', onNpc);
      bus.off('hint', onHint);
    };
  }, []);

  const closeOverlay = () => { setMenu(null); setDialog(null); setShop(false); bus.emit('ui-close'); };

  // Start Course: the town sleeps (no frames, no key capture) while the game fills the screen;
  // leaving wakes it with the player exactly where they entered.
  const startCourse = (course: Course) => {
    const g = gameRef.current;
    if (g?.input.keyboard) { g.input.keyboard.enabled = false; g.input.keyboard.preventDefault = false; }
    g?.loop.sleep();
    setMenu(null);
    if (parked && parked.id !== course.id) setParked(null);
    setPlaying(course);
  };
  const exitCourse = () => {
    const g = gameRef.current;
    if (g?.input.keyboard) { g.input.keyboard.enabled = true; g.input.keyboard.preventDefault = true; }
    g?.scene.getScene('town')?.input.keyboard?.resetKeys();
    g?.loop.wake();
    setParked(playing);
    setPlaying(null);
    bus.emit('ui-close');
  };

  useEffect(() => {
    if (!host.current) return;
    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: host.current,
      width: 960,
      height: 540,
      backgroundColor: '#146135', // forest-floor green (G_DARK): never a visible void,
      pixelArt: true,
      roundPixels: true,
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [TownScene],
    });
    gameRef.current = game;
    let cancelled = false;
    weatherFor().then(({ mode, where, source }) => {
      if (cancelled) return;
      game.scene.start('town', { charRow, weather: mode });
      if (source === 'auto') bus.emit('weather', { mode, where });
    });
    return () => { cancelled = true; gameRef.current = null; game.destroy(true); };
  }, [charRow]);

  const anyUi = !!(menu || dialog || shop || playing);
  const updated = formatUpdated(WORLD.generatedAt);

  return (
    <div className="game-stage">
      <div ref={host} className="game-host" />
      <div className="hud-top">
        <div className="sd-panel hud-name">{hire.name} · {COMPANY.name}</div>
        <div className="sd-panel hud-credits" title="Credits"><Coin size={20} /><span>{credits}</span></div>
        <div className="credit-pops">
          {popups.map(p => (
            <div key={p.id} className="credit-pop" style={{ animationDelay: `${p.delay}ms` }}>
              <span>+{p.delta}</span><Coin size={22} />
            </div>
          ))}
        </div>
      </div>
      {hover && !anyUi && (
        <BuildingTip hover={hover} />
      )}
      {hint && !anyUi && <div className="sd-panel hint">{hint} · E / tap</div>}
      <div className="world-meta">
        {WORLD.offline && <span className="world-offline">offline stand-in content</span>}
        {updated && <span>updated {updated}</span>}
      </div>
      {dialog && <NpcDialog npc={dialog} onClose={closeOverlay} />}
      {menu && <CourseMenu course={menu} onStart={() => startCourse(menu)} onClose={closeOverlay} />}
      {shop && <ShopMenu credits={credits} onClose={closeOverlay} />}
      <Joystick />
      <button className="act-btn" onPointerDown={() => { input.interact = true; }}>A</button>
      {(playing ?? parked) && (
        <CourseGame
          key={(playing ?? parked)!.id}
          course={(playing ?? parked)!}
          hidden={!playing}
          onResult={r => { const c = playing ?? parked!; recordResult(c, r); reportResult(c, r); }}
          onExit={exitCourse}
        />
      )}
    </div>
  );
}
