import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { TownScene } from '../game/TownScene';
import { bus, input } from '../game/bridge';
import { COMPANY, type Course, type Npc } from '../config';
import type { Hire } from '../App';
import { resolveWeather } from '../weather';

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

function CourseMenu({ course, onClose }: { course: Course; onClose: () => void }) {
  const [view, setView] = useState<'menu' | 'progress'>('menu');
  return (
    <div className="menu-overlay" onClick={onClose}>
      <div className="sd-panel menu-card" onClick={e => e.stopPropagation()}>
        <h2>{course.name}</h2>
        <p className="m-sub">{COMPANY.name} · course</p>
        {view === 'menu' ? (
          <>
            <button className="sd-btn" onClick={() => setView('progress')}>View Progress</button>
            <button className="sd-btn" disabled title="Minigames land in a later build">Start Course</button>
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

export default function Game({ hire, charRow }: { hire: Hire; charRow: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ course: Course; x: number; y: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Npc | null>(null);
  const [menu, setMenu] = useState<Course | null>(null);

  useEffect(() => {
    const onHover = (d: { course: Course | null; x: number; y: number }) =>
      setHover(d.course ? { course: d.course, x: d.x, y: d.y } : null);
    const onEnter = (d: { course: Course }) => { setMenu(d.course); bus.emit('ui-open'); };
    const onNpc = (d: { npc: Npc }) => { setDialog(d.npc); bus.emit('ui-open'); };
    const onHint = (d: { text: string | null }) => setHint(prev => prev === d.text ? prev : d.text);
    bus.on('hover-building', onHover);
    bus.on('enter-building', onEnter);
    bus.on('npc-dialog', onNpc);
    bus.on('hint', onHint);
    return () => {
      bus.off('hover-building', onHover);
      bus.off('enter-building', onEnter);
      bus.off('npc-dialog', onNpc);
      bus.off('hint', onHint);
    };
  }, []);

  const closeOverlay = () => { setMenu(null); setDialog(null); bus.emit('ui-close'); };

  useEffect(() => {
    if (!host.current) return;
    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: host.current,
      width: 960,
      height: 540,
      backgroundColor: '#1a2410',
      pixelArt: true,
      roundPixels: true,
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [TownScene],
    });
    let cancelled = false;
    resolveWeather().then(({ mode, where, source }) => {
      if (cancelled) return;
      game.scene.start('town', { charRow, weather: mode });
      if (source === 'auto') bus.emit('weather', { mode, where });
    });
    return () => { cancelled = true; game.destroy(true); };
  }, [charRow]);

  const anyUi = !!(menu || dialog);

  return (
    <div className="game-stage">
      <div ref={host} />
      <div className="sd-panel hud-name">{hire.name} · {COMPANY.name}</div>
      {hover && !anyUi && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          <span className="t-name">{hover.course.name}</span>
          <div className="sd-bar"><i style={{ width: `${hover.course.completion}%` }} /></div>
          <span className="t-pct">{hover.course.completion}% complete</span>
        </div>
      )}
      {hint && !anyUi && <div className="sd-panel hint">{hint} — E / tap</div>}
      {dialog && <NpcDialog npc={dialog} onClose={closeOverlay} />}
      {menu && <CourseMenu course={menu} onClose={closeOverlay} />}
      <Joystick />
      <button className="act-btn" onPointerDown={() => { input.interact = true; }}>A</button>
    </div>
  );
}
