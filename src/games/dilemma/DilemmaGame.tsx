"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blip, sweep, thud } from "../core/sound";
import type { GameProps } from "../core/types";
import { useTypewriter } from "../core/useTypewriter";
import { SoundIcon } from "../core/SoundIcon";
import { Backdrop, Desk, Portrait, ShoutBubble } from "./art";
import { choose, createDilemma, displayedOptions, isThought, maxScore, parseRich, resolveLook, sliceRich, type DilemmaState } from "./logic";
import type { CastMember, DilemmaSpec, Line, Mood } from "./spec";
import { backgroundFor, preloadList, SHOUTS, spriteFor, viewForSetting, type CharacterId, type View } from "./sprites";
import styles from "./dilemma.module.css";

type Beat =
  | { kind: "banner"; scene: number }
  | { kind: "line"; line: Line }
  | { kind: "question"; line: Line }
  | { kind: "shout"; text: string; colour: string }
  | { kind: "penalty" }
  | { kind: "verdict" };

type Anim = "" | "enter" | "jolt" | "lean" | "pointing";

interface StageState {
  /** A cast id, "player", or "judge" (the verdict). */
  who: string;
  mood: Mood;
  pose?: "point";
  anim: Anim;
  key: number;
}

/** Animation classes for drawn characters (centred box) and for full-frame sprites. */
const DRAWN_ANIM: Record<Anim, string> = { "": "", enter: styles.enter, jolt: styles.jolt, lean: styles.lean, pointing: styles.pointing };
const SPRITE_ANIM: Record<Anim, string> = { "": "", enter: styles.layerEnter, jolt: styles.layerJolt, lean: styles.layerLean, pointing: styles.layerPoint };

const VOICE_HZ = { low: 210, mid: 320, high: 470 } as const;
const BANNER_MS = 1700;
const SHOUT_MS = 1300;
const PENALTY_MS = 950;
const REACTION: Record<"best" | "acceptable" | "wrong", string> = {
  best: "That's right!",
  acceptable: "Hmm... close, but",
  wrong: "Ugh... I blew it.",
};

const sceneScript = (spec: DilemmaSpec, scene: number): Beat[] => [
  { kind: "banner", scene },
  ...spec.scenes[scene].lines.map((line): Beat => ({ kind: "line", line })),
  { kind: "question", line: spec.scenes[scene].question },
];

export function DilemmaGame({ spec, onComplete, instant = false }: GameProps<DilemmaSpec>) {
  const [phase, setPhase] = useState<"title" | "play">("title");
  const [game, setGame] = useState<DilemmaState>(() => createDilemma(spec));
  const [beats, setBeats] = useState<Beat[]>([]);
  const [index, setIndex] = useState(0);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [stage, setStage] = useState<StageState>({ who: spec.cast[0].id, mood: "neutral", anim: "", key: 0 });
  const [flash, setFlash] = useState<{ red: boolean; key: number } | null>(null);
  const [trust, setTrust] = useState(spec.credibility);
  const [breaking, setBreaking] = useState<number | null>(null);
  const [sound, setSound] = useState(!instant);
  const [brokenPacks, setBrokenPacks] = useState<CharacterId[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const busyUntil = useRef(0);
  const keySeq = useRef(0);
  const startedAt = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const sfx = useCallback((fn: () => void) => sound && !instant && fn(), [sound, instant]);

  const castById = useCallback((id: string): CastMember | undefined => spec.cast.find((c) => c.id === id), [spec.cast]);

  const shake = useCallback(
    (strength: number) => {
      const el = stageRef.current;
      if (instant || !el || typeof el.animate !== "function") return;
      el.animate(
        [0, -1, 1, -0.7, 0.7, -0.3, 0].map((k) => ({ transform: `translate(${k * strength}px, ${-k * strength * 0.4}px)` })),
        { duration: 450, easing: "steps(6, end)" },
      );
    },
    [instant],
  );

  const show = useCallback((who: string, mood: Mood, pose?: "point") => {
    setStage((s) => {
      const anim: Anim = s.who !== who ? "enter" : pose ? "pointing" : mood === "shocked" ? "jolt" : mood === "angry" ? "lean" : "";
      return { who, mood, pose, anim, key: s.who !== who || anim ? ++keySeq.current : s.key };
    });
  }, []);

  /** Applies a beat's effects as it starts. */
  const enter = useCallback(
    (beat: Beat) => {
      busyUntil.current = 0;
      switch (beat.kind) {
        case "banner": {
          setSceneIdx(beat.scene);
          const first = spec.scenes[beat.scene].lines.find((l) => castById(l.speaker)) ?? spec.scenes[beat.scene].question;
          if (castById(first.speaker)) show(first.speaker, "neutral");
          sfx(() => sweep(180, 620, 380, "triangle", 0.04));
          break;
        }
        case "line":
        case "question": {
          const { speaker, mood = "neutral", text } = beat.line;
          if (castById(speaker)) show(speaker, mood);
          else if (speaker === "player" && !isThought(text)) show("player", mood);
          break;
        }
        case "shout":
          busyUntil.current = instant ? 0 : Date.now() + SHOUT_MS;
          show("player", "confident", "point");
          setFlash({ red: false, key: ++keySeq.current });
          shake(10);
          sfx(() => {
            sweep(1100, 260, 420, "square", 0.06);
            thud(240, 0.4);
          });
          break;
        case "penalty":
          busyUntil.current = instant ? 0 : Date.now() + PENALTY_MS;
          // The player takes the hit, like the attorney reeling after a bad answer.
          show("player", "shocked");
          setFlash({ red: true, key: ++keySeq.current });
          shake(12);
          setTrust(trust - 1);
          setBreaking(trust - 1);
          sfx(() => {
            thud(320, 0.5);
            sweep(240, 60, 600, "sawtooth", 0.06);
          });
          break;
        case "verdict":
          // The Judge delivers it, nodding or shaking his head, when the game uses Ace Attorney sprites.
          if (spec.player.character) show("judge", game.status === "won" ? "happy" : "sad");
          sfx(() =>
            (game.status === "won" ? [523, 659, 784, 1047, 1319] : [392, 330, 262, 196]).forEach((f, i) =>
              timers.current.push(setTimeout(() => blip(f, 180, "square", 0.045), i * 140)),
            ),
          );
          break;
      }
    },
    [spec.scenes, spec.player.character, castById, show, sfx, shake, instant, game.status, trust],
  );

  const play = useCallback(
    (next: Beat[]) => {
      setBeats(next);
      setIndex(0);
      enter(next[0]);
    },
    [enter],
  );

  const beat = beats[index];
  const line = beat && (beat.kind === "line" || beat.kind === "question") ? beat.line : null;
  const thought = line ? isThought(line.text) : false;
  const segments = parseRich(line?.text ?? "");
  const speakerCast = line ? castById(line.speaker) : undefined;
  const voice = line && !thought && line.speaker !== "narrator" ? VOICE_HZ[speakerCast?.voice ?? "mid"] : null;
  const typer = useTypewriter(
    segments.map((s) => s.text).join(""),
    { instant, cps: 40, onTick: (c) => voice && /[a-z0-9]/i.test(c) && sfx(() => blip(voice + ((c.charCodeAt(0) % 5) - 2) * 12, 28, "square", 0.025)) },
  );
  const shown = sliceRich(segments, typer.shown.length);

  const advance = useCallback(() => {
    if (phase !== "play" || !beat || beat.kind === "verdict") return;
    if (line && !typer.done) return typer.skip();
    if (beat.kind === "question" || Date.now() < busyUntil.current) return;
    if (index + 1 < beats.length) {
      setIndex(index + 1);
      enter(beats[index + 1]);
    } else if (game.status === "playing") {
      play(sceneScript(spec, game.scene));
    } else {
      play([{ kind: "verdict" }]);
    }
  }, [phase, beat, line, typer, index, beats, enter, game, play, spec]);

  // Banners, shouts and penalties move on by themselves, like the game's set pieces.
  useEffect(() => {
    if (instant || !beat || !["banner", "shout", "penalty"].includes(beat.kind)) return;
    const ms = beat.kind === "banner" ? BANNER_MS : beat.kind === "shout" ? SHOUT_MS : PENALTY_MS;
    const id = setTimeout(advance, ms);
    return () => clearTimeout(id);
  }, [instant, beat, advance]);

  const start = () => {
    startedAt.current = Date.now();
    if (!instant && typeof Image !== "undefined") {
      // Warm the cache so expressions swap without a blank frame.
      const ids = [spec.player.character, "judge" as const, ...spec.cast.map((c) => c.character)].filter((c): c is CharacterId => !!c);
      for (const src of preloadList(ids)) new Image().src = src;
    }
    setPhase("play");
    play(sceneScript(spec, 0));
  };

  const pick = (displayIndex: number) => {
    if (beat?.kind !== "question" || !typer.done) return;
    sfx(() => blip(660, 50));
    const { state: next, option } = choose(game, spec, displayIndex);
    setGame(next);
    const reaction: Beat[] = [];
    if (option.verdict === "best") reaction.push({ kind: "shout", text: "OBJECTION!", colour: "#e8231f" });
    else if (option.verdict === "acceptable") reaction.push({ kind: "shout", text: "HOLD IT!", colour: "#2463e8" });
    else reaction.push({ kind: "penalty" });
    reaction.push(...option.response.map((l): Beat => ({ kind: "line", line: l })));
    reaction.push({ kind: "line", line: { speaker: "player", text: `(${REACTION[option.verdict]} ${option.feedback})` } });
    play(reaction);
  };

  const finish = () =>
    onComplete?.({
      gameId: "dilemma",
      won: game.status === "won",
      score: game.score,
      maxScore: maxScore(spec),
      correct: game.correct,
      total: game.answered,
      durationMs: Date.now() - startedAt.current,
      mistakes: game.mistakes,
    });

  // Keyboard: Space/Enter advance, 1-4 answer.
  const keys = useRef({ advance, pick });
  useEffect(() => {
    keys.current = { advance, pick };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ([" ", "Enter"].includes(e.key)) {
        e.preventDefault();
        keys.current.advance();
      } else if (/^[1-4]$/.test(e.key)) keys.current.pick(Number(e.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const scene = spec.scenes[sceneIdx];
  const setting = scene.setting;
  const onStage = stage.who === "player" || stage.who === "judge" ? null : castById(stage.who);
  const look = stage.who === "player" ? resolveLook("player", spec.player.look) : resolveLook(stage.who, onStage?.look);
  // Ace Attorney sprites when the character on stage has a pack (and its images load); drawn characters otherwise.
  const pack: CharacterId | undefined = stage.who === "player" ? spec.player.character : stage.who === "judge" ? "judge" : onStage?.character;
  const sprite = pack && !brokenPacks.includes(pack) ? pack : undefined;
  const view: View = stage.who === "player" ? "defense" : stage.who === "judge" ? "witness" : viewForSetting(setting);
  const desk = view === "defense" ? "defense" : view === "witness" ? (stage.who === "judge" ? "judge" : "witness") : null;
  const shoutImage = beat?.kind === "shout" && spec.player.character ? (beat.text === "HOLD IT!" ? SHOUTS.holdIt : SHOUTS.objection) : null;
  const talking = !!line && !typer.done && !thought && line.speaker === stage.who;
  const name = line ? (line.speaker === "narrator" ? null : line.speaker === "player" ? spec.player.name : (speakerCast?.name ?? line.speaker)) : null;
  const options = beat?.kind === "question" && typer.done ? displayedOptions(game, spec) : [];
  const won = game.status === "won";
  const verdictWord = won ? "CLEARED!" : "NOT READY";

  return (
    <div ref={stageRef} className={styles.stage} onClick={advance} data-testid="dilemma">
      {/* The scene: the whole stage on wide screens, the top screen above the text on phones. */}
      <div className={styles.scene}>
        <div className={styles.backdrop}>
          {sprite ? (
            // eslint-disable-next-line @next/next/no-img-element -- static game art served from /public
            <img className={styles.backgroundImg} src={backgroundFor(view)} alt="" />
          ) : (
            <Backdrop setting={setting} label={onStage?.name} />
          )}
        </div>
        {beat?.kind === "shout" && <div className={styles.speedlines} />}
        {beat?.kind === "penalty" && <div className={`${styles.speedlines} ${styles.speedlinesRed}`} />}

        {phase === "play" &&
          (sprite ? (
            <div key={`char-${stage.key}`} className={`${styles.spriteLayer} ${SPRITE_ANIM[stage.anim]}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- animated GIF sprites, served as-is */}
              <img
                className={styles.spriteImg}
                src={spriteFor(sprite, stage.mood, talking, stage.pose)}
                alt={stage.who === "player" ? spec.player.name : (onStage?.name ?? "Judge")}
                onError={() => setBrokenPacks((b) => [...b, sprite])}
                draggable={false}
              />
            </div>
          ) : (
            <div key={`char-${stage.key}`} className={`${styles.character} ${setting === "video-call" && stage.who !== "player" ? styles.characterCall : ""} ${DRAWN_ANIM[stage.anim]}`}>
              <div className={styles.characterInner}>
                {onStage?.portraitUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- spec-supplied portrait, any host
                  <img className={styles.portraitImg} src={onStage.portraitUrl} alt={onStage.name} />
                ) : (
                  <Portrait look={look} mood={stage.mood} talking={talking} pose={stage.pose} />
                )}
              </div>
            </div>
          ))}
        {sprite ? (
          desk && <Desk kind={desk} />
        ) : (
          <div className={`${styles.desk} ${setting === "reception" ? styles.counter : ""} ${setting === "video-call" ? styles.noDesk : ""}`} />
        )}
      </div>

      {phase === "play" && (
        <div className={styles.trust} aria-label={`Trust ${trust} of ${spec.credibility}`}>
          TRUST
          {Array.from({ length: spec.credibility }, (_, i) => (
            <span key={`${i}-${breaking === i ? "b" : ""}`} className={`${styles.segment} ${i === breaking ? styles.segmentBreaking : i >= trust ? styles.segmentLost : ""}`} />
          ))}
        </div>
      )}

      {line && (
        <>
          {name && <div className={styles.nametag}>{name}</div>}
          <div className={styles.textbox} role="status" aria-live="polite" data-testid="textbox">
            <span className={thought ? styles.thought : undefined}>
              {shown.map((s, i) =>
                s.emphasis ? (
                  <span key={i} className={styles.emphasis}>
                    {s.text}
                  </span>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )}
            </span>
            {typer.done && beat?.kind !== "question" && <span className={styles.advance}>▶</span>}
          </div>
        </>
      )}

      {options.length > 0 && (
        <div className={styles.choices} onClick={(e) => e.stopPropagation()}>
          <div className={styles.choicesLabel}>WHAT WILL YOU SAY?</div>
          {options.map((o, i) => (
            <button key={o.text} className={styles.choice} onClick={() => pick(i)}>
              {o.text}
            </button>
          ))}
        </div>
      )}

      {beat?.kind === "shout" && (
        <div className={styles.shout}>
          {shoutImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- the games' own shout graphic
            <img className={styles.shoutImg} src={shoutImage} alt={beat.text} />
          ) : (
            <ShoutBubble text={beat.text} colour={beat.colour} />
          )}
        </div>
      )}
      {flash && <div key={`flash-${flash.key}`} className={`${styles.flash} ${flash.red ? styles.flashRed : ""}`} />}

      {beat?.kind === "banner" && (
        <div key={`banner-${beat.scene}`} className={styles.banner}>
          <span className={styles.bannerKicker}>
            — SCENE {beat.scene + 1} OF {spec.scenes.length} —
          </span>
          <span className={styles.bannerTitle}>{spec.scenes[beat.scene].title}</span>
        </div>
      )}

      {beat?.kind === "verdict" && (
        <div className={styles.verdict}>
          <div className={styles.verdictWord} aria-label={verdictWord}>
            {[...verdictWord].map((ch, i) => (
              <span key={i} className={`${styles.letter} ${won ? "" : styles.letterBad}`} style={{ animationDelay: `${i * 0.12}s` }}>
                {ch === " " ? " " : ch}
              </span>
            ))}
          </div>
          {won &&
            !instant &&
            Array.from({ length: 40 }, (_, i) => (
              <span
                key={i}
                className={styles.paper}
                style={
                  {
                    left: `${(i * 29) % 100}%`,
                    "--c": ["#ffd166", "#ffffff", "#79c9ff", "#ff5f56"][i % 4],
                    "--t": `${1.6 + (i % 5) * 0.3}s`,
                    "--r": `${(i % 2 ? 1 : -1) * (300 + i * 17)}deg`,
                    animationDelay: `${1 + (i % 8) * 0.08}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          <button
            className={styles.resultsButton}
            onClick={(e) => {
              e.stopPropagation();
              finish();
            }}
          >
            See results
          </button>
        </div>
      )}

      {phase === "title" && (
        <div className={styles.title} onClick={(e) => e.stopPropagation()}>
          <div className={styles.titleLogo}>{spec.title}</div>
          {spec.intro && <p className={styles.titleIntro}>{spec.intro}</p>}
          <button className={styles.startButton} onClick={start}>
            ▶ BEGIN
          </button>
        </div>
      )}
      <button
        className={styles.soundToggle}
        onClick={(e) => {
          e.stopPropagation();
          setSound((s) => !s);
        }}
        aria-label={sound ? "Mute" : "Unmute"}
      >
        <SoundIcon on={sound} />
      </button>
    </div>
  );
}
