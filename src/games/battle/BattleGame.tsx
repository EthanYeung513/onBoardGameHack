"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blip, playClip, sweep, thud } from "../core/sound";
import type { GameProps } from "../core/types";
import { useTypewriter } from "../core/useTypewriter";
import { SoundIcon } from "../core/SoundIcon";
import { answer, CRIT_WINDOW_MS, createBattle, displayedChoices, MAX_HP, maxScore, type BattleState } from "./logic";
import type { BattleSpec } from "./spec";
import styles from "./battle.module.css";

const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated";
const frontSprite = (id: number) => `${SPRITES}/${id}.gif`;
const backSprite = (id: number) => `${SPRITES}/back/${id}.gif`;
const cry = (id: number) => `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`;
const MOVE_TYPES = ["normal", "fire", "water", "grass"] as const;

type Phase = "title" | "intro" | "talk" | "menu" | "end";
type Effect = "foeEnter" | "playerEnter" | "playerHit" | "playerCrit" | "playerMiss" | "foeAttack" | "foeFaint" | "playerFaint" | "exp" | "blackout";
interface Msg {
  text: string;
  effect?: Effect;
  /** Target HP for hit effects. */
  hp?: number;
}

/** How long each effect needs before the next message may show. */
const EFFECT_MS: Record<Effect, number> = {
  foeEnter: 900,
  playerEnter: 900,
  playerHit: 1500,
  playerCrit: 1700,
  playerMiss: 650,
  foeAttack: 1500,
  foeFaint: 1000,
  playerFaint: 1000,
  exp: 1500,
  blackout: 1600,
};
const HOLD_MS = 1100;

const hpColour = (hp: number) => (hp > 50 ? "var(--hp-green)" : hp > 20 ? "var(--hp-yellow)" : "var(--hp-red)");

function Sprite({ src, fallback, alt }: { src: string; fallback: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className={styles.emoji} role="img" aria-label={alt}>{fallback}</span>;
  // eslint-disable-next-line @next/next/no-img-element -- animated GIF sprites, served as-is
  return <img className={styles.sprite} src={src} alt={alt} onError={() => setBroken(true)} draggable={false} />;
}

function HpBox({ name, level, hp, player, exp }: { name: string; level: number; hp: number; player?: boolean; exp?: number }) {
  return (
    <div className={`${styles.hpBox} ${player ? styles.playerBox : styles.foeBox}`} aria-label={`${name} HP ${hp} of ${MAX_HP}`}>
      <div className={styles.hpTop}>
        <span>{name}</span>
        <span className={styles.level}>Lv{level}</span>
      </div>
      <div className={styles.hpRow}>
        <span className={styles.hpLabel}>HP</span>
        <div className={styles.hpTrack}>
          <div className={styles.hpFill} style={{ width: `${hp}%`, backgroundColor: hpColour(hp) }} />
        </div>
      </div>
      {player && (
        <>
          <div className={styles.hpNumbers}>
            {hp}/ {MAX_HP}
          </div>
          <div className={styles.expTrack}>
            <div className={styles.expFill} style={{ width: `${exp ?? 0}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

export function BattleGame({ spec, onComplete, instant = false }: GameProps<BattleSpec>) {
  const [phase, setPhase] = useState<Phase>("title");
  const [battle, setBattle] = useState<BattleState>(() => createBattle(spec));
  const [queue, setQueue] = useState<Msg[]>([]);
  const [msgIndex, setMsgIndex] = useState(0);
  const [foeShown, setFoeShown] = useState(false);
  const [playerShown, setPlayerShown] = useState(false);
  const [foeAnim, setFoeAnim] = useState({ cls: "", key: 0 });
  const [playerAnim, setPlayerAnim] = useState({ cls: "", key: 0 });
  const [foeHp, setFoeHp] = useState(MAX_HP);
  const [playerHp, setPlayerHp] = useState(MAX_HP);
  const [fx, setFx] = useState<{ impact?: "foe" | "player"; crit?: boolean; flash?: "white" | "red"; key: number }>({ key: 0 });
  const [exp, setExp] = useState(0);
  const [blackout, setBlackout] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [sound, setSound] = useState(!instant);
  const screenRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const readyAt = useRef(0);
  const busyUntil = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = useCallback(
    (ms: number, fn: () => void) => {
      if (instant) return fn();
      timers.current.push(setTimeout(fn, ms));
    },
    [instant],
  );
  const sfx = useCallback((fn: () => void) => sound && !instant && fn(), [sound, instant]);

  const anim = (set: typeof setFoeAnim, cls: string) => set((a) => ({ cls, key: a.key + 1 }));

  /** Shakes the screen in place (no remount, so HP bars keep draining smoothly). */
  const shake = useCallback(
    (big: boolean) => {
      const el = screenRef.current;
      if (instant || !el || typeof el.animate !== "function") return;
      const d = big ? 9 : 6;
      el.animate(
        [
          { transform: "translate(0, 0)" },
          { transform: `translate(${-d}px, ${d / 2}px)` },
          { transform: `translate(${d}px, ${-d / 2}px)` },
          { transform: `translate(${-d / 1.5}px, ${-d / 3}px)` },
          { transform: `translate(${d / 1.5}px, ${d / 2}px)` },
          { transform: `translate(${-d / 3}px, 0)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: big ? 650 : 420, easing: "steps(6, end)" },
      );
    },
    [instant],
  );

  const runEffect = useCallback(
    (msg: Msg) => {
      const effect = msg.effect;
      if (!effect) return;
      busyUntil.current = instant ? 0 : Date.now() + EFFECT_MS[effect];
      switch (effect) {
        case "foeEnter":
          setFoeShown(true);
          anim(setFoeAnim, styles.enterFromLeft);
          later(750, () => anim(setFoeAnim, styles.idle));
          sfx(() => playClip(cry(spec.opponent.pokemon), 0.35));
          break;
        case "playerEnter":
          setPlayerShown(true);
          anim(setPlayerAnim, styles.enterFromRight);
          sfx(() => playClip(cry(spec.player.pokemon), 0.35));
          break;
        case "playerHit":
        case "playerCrit": {
          const crit = effect === "playerCrit";
          anim(setPlayerAnim, styles.lungeForward);
          later(230, () => {
            setFx((f) => ({ impact: "foe", crit, flash: crit ? "white" : undefined, key: f.key + 1 }));
            if (crit) shake(true);
            anim(setFoeAnim, styles.flicker);
            sfx(() => thud(crit ? 260 : 170, crit ? 0.45 : 0.3));
            later(480, () => setFoeHp(msg.hp ?? 0));
          });
          break;
        }
        case "playerMiss":
          anim(setPlayerAnim, styles.whiff);
          sfx(() => sweep(520, 180, 260, "triangle"));
          break;
        case "foeAttack":
          anim(setFoeAnim, styles.lungeBack);
          later(230, () => {
            setFx((f) => ({ impact: "player", flash: "red", key: f.key + 1 }));
            shake(false);
            anim(setPlayerAnim, styles.flicker);
            sfx(() => thud(200, 0.35));
            later(480, () => setPlayerHp(msg.hp ?? 0));
          });
          break;
        case "foeFaint":
          anim(setFoeAnim, styles.faint);
          sfx(() => playClip(cry(spec.opponent.pokemon), 0.35));
          break;
        case "playerFaint":
          anim(setPlayerAnim, styles.faint);
          sfx(() => sweep(400, 90, 700, "square", 0.04));
          break;
        case "exp":
          later(150, () => setExp(100));
          sfx(() => sweep(300, 1200, 900, "square", 0.03));
          break;
        case "blackout":
          setBlackout(true);
          break;
      }
    },
    [instant, later, sfx, shake, spec.opponent.pokemon, spec.player.pokemon],
  );

  const talk = useCallback(
    (msgs: Msg[]) => {
      setQueue(msgs);
      setMsgIndex(0);
      setPhase("talk");
      runEffect(msgs[0]);
    },
    [runEffect],
  );

  const message = phase === "talk" || phase === "end" ? queue[msgIndex] : undefined;
  const round = spec.rounds[battle.current];
  const boxText = phase === "menu" ? round.prompt : (message?.text ?? "");
  const typer = useTypewriter(boxText, { instant, cps: 55 });
  const ready = phase === "menu" && typer.done;

  useEffect(() => {
    if (ready) readyAt.current = Date.now();
  }, [ready, battle.attempts]);

  const advance = useCallback(() => {
    if (phase !== "talk") return;
    if (!typer.done) return typer.skip();
    if (Date.now() < busyUntil.current) return;
    if (msgIndex + 1 < queue.length) {
      setMsgIndex(msgIndex + 1);
      runEffect(queue[msgIndex + 1]);
      return;
    }
    if (battle.status === "playing") setPhase("menu");
    else setPhase("end");
  }, [phase, typer, msgIndex, queue, runEffect, battle.status]);

  // Auto-advance once the text is out and the effect has played, like the games' timed text.
  useEffect(() => {
    if (instant || phase !== "talk" || !typer.done) return;
    const wait = Math.max(0, busyUntil.current - Date.now()) + HOLD_MS;
    const id = setTimeout(advance, wait);
    return () => clearTimeout(id);
  }, [instant, phase, typer.done, advance]);

  const start = () => {
    startedAt.current = Date.now();
    sfx(() => sweep(200, 900, 500, "square", 0.03));
    if (instant) {
      return talk([
        { text: `A wild ${spec.opponent.name} appeared!`, effect: "foeEnter" },
        { text: `Go! ${spec.player.name}!`, effect: "playerEnter" },
      ]);
    }
    setPhase("intro");
    setWipe(true);
    later(1500, () => {
      setWipe(false);
      talk([
        { text: `A wild ${spec.opponent.name} appeared!`, effect: "foeEnter" },
        { text: `Go! ${spec.player.name}!`, effect: "playerEnter" },
      ]);
    });
  };

  const choose = (displayIndex: number) => {
    if (!ready) return;
    sfx(() => blip(880, 40));
    const elapsed = Date.now() - readyAt.current;
    const { state: next, outcome } = answer(battle, spec, displayIndex, elapsed);
    setBattle(next);
    const p = spec.player.name;
    const f = spec.opponent.name;
    const msgs: Msg[] = [{ text: `${p} used ${outcome.chosen.toUpperCase()}!`, effect: outcome.correct ? (outcome.crit ? "playerCrit" : "playerHit") : "playerMiss", hp: next.foeHp }];
    if (outcome.correct) {
      if (outcome.crit) msgs.push({ text: "A critical hit!" });
      msgs.push({ text: "It's super effective!" });
      msgs.push({ text: round.explanation });
    } else {
      const move = spec.opponent.moves[battle.attempts % spec.opponent.moves.length];
      msgs.push({ text: `${p}'s attack missed!` });
      msgs.push({ text: `${f} used ${move.toUpperCase()}!`, effect: "foeAttack", hp: next.playerHp });
      msgs.push({ text: `The right move was "${outcome.expected}". ${round.explanation}` });
    }
    if (next.status === "won") {
      msgs.push({ text: `${f} fainted!`, effect: "foeFaint" });
      msgs.push({ text: `${p} gained ${next.score} EXP. Points!`, effect: "exp" });
    } else if (next.status === "lost") {
      msgs.push({ text: `${p} fainted!`, effect: "playerFaint" });
      msgs.push({ text: `${p} is out of usable moves... ${p} blacked out!`, effect: "blackout" });
    }
    talk(msgs);
  };

  const finish = () =>
    onComplete?.({
      gameId: "battle",
      won: battle.status === "won",
      score: battle.score,
      maxScore: maxScore(spec),
      correct: battle.correct,
      total: battle.attempts,
      durationMs: Date.now() - startedAt.current,
      mistakes: battle.mistakes,
    });

  // Keyboard: Space/Enter/Z advance, 1-4 pick a move.
  const keys = useRef({ advance, choose, phase });
  useEffect(() => {
    keys.current = { advance, choose, phase };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (k.phase === "talk" && [" ", "Enter", "z", "Z"].includes(e.key)) {
        e.preventDefault();
        k.advance();
      } else if (k.phase === "menu" && /^[1-4]$/.test(e.key)) {
        k.choose(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choices = displayedChoices(battle, spec);
  const livesLeft = Math.ceil((battle.playerHp / MAX_HP) * spec.lives);

  return (
    <div className={styles.console} data-testid="battle">
      <div className={styles.statusBar}>
        <span>{spec.title}</span>
        <span className={styles.balls} aria-label={`${livesLeft} of ${spec.lives} lives left`}>
          {Array.from({ length: spec.lives }, (_, i) => (
            <span key={i} className={`${styles.ball} ${i >= livesLeft ? styles.ballEmpty : ""}`} />
          ))}
        </span>
        <button className={styles.iconButton} onClick={() => setSound((s) => !s)} aria-label={sound ? "Mute" : "Unmute"}>
          <SoundIcon on={sound} />
        </button>
      </div>

      <div ref={screenRef} className={`${styles.screen} ${fx.crit ? styles.crit : ""}`}>
        <div className={styles.foeSide}>
          <div className={styles.platform} />
          <div className={styles.spriteFrame}>
            <div key={`foe-${foeAnim.key}`} className={`${styles.spriteAnim} ${foeShown ? foeAnim.cls : styles.hidden}`}>
              <Sprite src={frontSprite(spec.opponent.pokemon)} fallback="👾" alt={spec.opponent.name} />
            </div>
          </div>
        </div>
        <div className={styles.playerSide}>
          <div className={styles.platform} />
          <div className={styles.spriteFrame}>
            <div key={`player-${playerAnim.key}`} className={`${styles.spriteAnim} ${playerShown ? playerAnim.cls : styles.hidden}`}>
              <Sprite src={backSprite(spec.player.pokemon)} fallback="🧑‍💼" alt={spec.player.name} />
            </div>
          </div>
        </div>

        {foeShown && <HpBox name={spec.opponent.name} level={spec.opponent.level} hp={foeHp} />}
        {playerShown && <HpBox name={spec.player.name} level={spec.player.level} hp={playerHp} exp={exp} player />}

        {fx.impact && (
          <div key={`impact-${fx.key}`} className={`${styles.impact} ${fx.impact === "foe" ? styles.impactFoe : styles.impactPlayer}`} aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className={styles.particle} style={{ "--angle": `${i * 45}deg` } as React.CSSProperties} />
            ))}
          </div>
        )}
        {fx.flash && <div key={`flash-${fx.key}`} className={`${styles.flash} ${fx.flash === "white" ? styles.flashWhite : styles.flashRed}`} aria-hidden />}

        {phase !== "title" && phase !== "intro" && (
          <div className={styles.textbox} onClick={advance} role="status" aria-live="polite" data-testid="textbox">
            {typer.shown}
            {phase === "talk" && typer.done && <span className={styles.arrow}>▼</span>}
          </div>
        )}

        {blackout && <div className={styles.blackout}>{spec.player.name} blacked out!</div>}
        {wipe && (
          <>
            <div className={styles.wipe} aria-hidden />
            <div className={styles.wipeFlash} aria-hidden />
          </>
        )}
        {phase === "title" && (
          <div className={styles.titleCard}>
            <h2>{spec.title}</h2>
            {spec.intro && <p>{spec.intro}</p>}
            <button className={styles.startButton} onClick={start}>
              ▶ Start battle
            </button>
          </div>
        )}
      </div>

      <div className={styles.bottom}>
        {phase === "menu" && (
          <>
            <div className={styles.critHint}>What will {spec.player.name} do? Answer fast for a critical hit!</div>
            <div className={styles.critTimer}>{ready && <div key={battle.attempts} className={styles.critFill} style={{ animationDuration: `${CRIT_WINDOW_MS}ms` }} />}</div>
            <div className={styles.moves}>
              {choices.map((choice, i) => (
                <button key={choice} className={`${styles.move} ${styles[MOVE_TYPES[i % 4]]}`} disabled={!ready} onClick={() => choose(i)}>
                  {choice}
                  <span className={styles.moveMeta}>
                    <span className={styles.typePill}>{MOVE_TYPES[i % 4].toUpperCase()}</span>
                    <span>PP 1/1</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {phase === "talk" && (
          <button className={styles.continue} onClick={advance}>
            Tap to continue ▶
          </button>
        )}
        {phase === "end" && (
          <button className={styles.resultsButton} onClick={finish}>
            {battle.status === "won" ? "🏆 See results" : "See results"}
          </button>
        )}
        {(phase === "title" || phase === "intro") && <div className={styles.continue} />}
      </div>
    </div>
  );
}
