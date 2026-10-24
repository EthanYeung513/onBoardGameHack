import type { Look, Mood } from "./spec";
import styles from "./dilemma.module.css";

const INK = "#1b1b24";
const MOUTH = "#4a1515";

/** Eyebrow paths per mood: [left, right]. */
const BROWS: Record<Mood, [string, string]> = {
  neutral: ["M70 95 L90 94", "M110 94 L130 95"],
  happy: ["M70 95 Q80 89 90 94", "M110 94 Q120 89 130 95"],
  thinking: ["M70 88 Q80 84 90 90", "M110 95 L130 95"],
  shocked: ["M70 86 Q80 80 90 86", "M110 86 Q120 80 130 86"],
  angry: ["M70 90 L91 99", "M130 90 L109 99"],
  sweating: ["M70 99 L90 91", "M130 99 L110 91"],
  sad: ["M70 98 L90 90", "M130 98 L110 90"],
  confident: ["M70 96 L90 94", "M110 91 Q120 87 130 92"],
};

const MOUTHS: Record<Mood, string> = {
  neutral: "M90 142 L110 142",
  happy: "M86 137 Q100 152 114 137 Z",
  thinking: "M94 143 L108 140",
  shocked: "",
  angry: "M86 146 Q100 135 114 146",
  sweating: "M87 142 Q93 138 100 142 Q107 146 113 142",
  sad: "M88 147 Q100 138 112 147",
  confident: "M89 142 Q104 147 115 136",
};

function Eyes({ mood }: { mood: Mood }) {
  if (mood === "happy")
    return (
      <g fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round">
        <path d="M73 114 Q81 105 89 114" />
        <path d="M111 114 Q119 105 127 114" />
      </g>
    );
  const shocked = mood === "shocked";
  const narrow = mood === "angry" || mood === "confident";
  const ry = shocked ? 10 : narrow ? 5 : 8;
  const rx = shocked ? 10 : 7.5;
  const look = mood === "thinking" ? { dx: 3, dy: -3 } : mood === "sad" ? { dx: 0, dy: 3 } : mood === "sweating" ? { dx: -2, dy: 0 } : { dx: 0, dy: 0 };
  const pupil = shocked ? 2.2 : 4;
  return (
    <g>
      {[81, 119].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={113} rx={rx} ry={ry} fill="#fff" stroke={INK} strokeWidth={2.5} />
          <circle cx={cx + look.dx} cy={113 + look.dy} r={pupil} fill={INK} />
          {!shocked && <circle cx={cx + look.dx + 1.5} cy={111 + look.dy} r={1.2} fill="#fff" />}
          {mood === "confident" && <path d={`M${cx - 9} 109 L${cx + 9} 109`} stroke={INK} strokeWidth={3} />}
        </g>
      ))}
    </g>
  );
}

function HairBack({ style, colour }: { style: Required<Look>["hairStyle"]; colour: string }) {
  if (style === "long") return <path d="M50 96 Q42 196 66 214 L134 214 Q158 196 150 96 Z" fill={colour} stroke={INK} strokeWidth={3} />;
  if (style === "bun") return <circle cx={100} cy={46} r={19} fill={colour} stroke={INK} strokeWidth={3} />;
  return null;
}

function HairFront({ style, colour }: { style: Required<Look>["hairStyle"]; colour: string }) {
  const common = { fill: colour, stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const };
  switch (style) {
    case "spiky":
      // Swept-back spikes, the classic defence-attorney silhouette.
      return <path d="M54 108 L34 82 L62 80 L36 50 L74 60 L66 22 L98 50 L112 14 L124 52 L158 28 L144 66 L176 66 L148 92 L150 108 Q138 80 116 76 Q96 88 78 78 Q60 84 54 108 Z" {...common} />;
    case "long":
    case "bob":
      return <path d="M48 128 Q42 52 100 48 Q158 52 152 128 L152 156 Q140 144 139 116 Q132 82 100 80 Q68 82 61 116 Q60 144 48 156 Z" {...common} />;
    case "bun":
    case "short":
      return <path d="M54 106 Q50 54 100 50 Q150 54 146 106 Q140 80 120 76 Q100 88 78 76 Q60 82 54 106 Z" {...common} />;
    case "bald":
      return <ellipse cx={86} cy={72} rx={12} ry={6} fill="#fff" opacity={0.35} />;
  }
}

/**
 * A character bust in the Ace Attorney manner: bold outlines, big expressions. Both mouth shapes are drawn and
 * CSS flips between them while `talking`, so the mouth flaps without re-rendering.
 */
export function Portrait({ look, mood, talking, pose }: { look: Required<Look>; mood: Mood; talking: boolean; pose?: "point" }) {
  const closedMouth = MOUTHS[mood];
  return (
    <svg viewBox="0 0 200 260" className={styles.portraitSvg} overflow="visible" aria-hidden>
      <HairBack style={look.hairStyle} colour={look.hair} />
      {/* Torso */}
      <path d="M14 262 Q18 196 70 180 L100 204 L130 180 Q182 196 186 262 Z" fill={look.outfit} stroke={INK} strokeWidth={3} />
      <path d="M78 180 L100 226 L122 180 L100 196 Z" fill={look.accent} stroke={INK} strokeWidth={2.5} />
      <path d="M70 180 L92 238 M130 180 L108 238" stroke={INK} strokeWidth={2.5} opacity={0.55} />
      {/* Neck and head */}
      <rect x={87} y={150} width={26} height={36} fill={look.skin} stroke={INK} strokeWidth={2.5} />
      <ellipse cx={54} cy={118} rx={7} ry={11} fill={look.skin} stroke={INK} strokeWidth={2.5} />
      <ellipse cx={146} cy={118} rx={7} ry={11} fill={look.skin} stroke={INK} strokeWidth={2.5} />
      <ellipse cx={100} cy={112} rx={46} ry={54} fill={look.skin} stroke={INK} strokeWidth={3} />
      {mood === "happy" && (
        <g fill="#ff7a8a" opacity={0.45}>
          <ellipse cx={70} cy={130} rx={8} ry={4} />
          <ellipse cx={130} cy={130} rx={8} ry={4} />
        </g>
      )}
      <Eyes mood={mood} />
      <g fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round">
        <path d={BROWS[mood][0]} />
        <path d={BROWS[mood][1]} />
      </g>
      <path d="M101 116 L97 128 L103 129" fill="none" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
      {/* Mouth: closed shape, plus an open shape shown while talking. */}
      <g className={talking ? styles.mouthTalking : undefined}>
        {mood === "shocked" ? (
          <ellipse cx={100} cy={144} rx={8} ry={10} fill={MOUTH} stroke={INK} strokeWidth={2.5} className={styles.mouthClosed} />
        ) : (
          <path
            d={closedMouth}
            fill={mood === "happy" ? MOUTH : "none"}
            stroke={INK}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.mouthClosed}
          />
        )}
        <ellipse cx={100} cy={143} rx={9} ry={mood === "shocked" ? 12 : 7} fill={MOUTH} stroke={INK} strokeWidth={2.5} className={styles.mouthOpen} />
      </g>
      {look.glasses && (
        <g fill="rgba(255,255,255,0.12)" stroke={INK} strokeWidth={3}>
          <rect x={68} y={102} width={26} height={21} rx={6} />
          <rect x={106} y={102} width={26} height={21} rx={6} />
          <path d="M94 110 L106 110" />
        </g>
      )}
      <HairFront style={look.hairStyle} colour={look.hair} />
      {(mood === "sweating" || mood === "shocked") && (
        <path d="M150 84 Q160 98 156 106 Q150 112 144 106 Q141 98 150 84 Z" fill="#a9ddff" stroke={INK} strokeWidth={2} className={styles.sweat} />
      )}
      {pose === "point" && (
        <g stroke={INK} strokeWidth={3} strokeLinejoin="round">
          <path d="M138 196 L196 150 L206 164 L152 216 Z" fill={look.outfit} />
          <circle cx={203} cy={154} r={13} fill={look.skin} />
          <path d="M210 146 L244 132 L247 141 L213 156 Z" fill={look.skin} />
        </g>
      )}
    </svg>
  );
}

/** The scene behind the characters, one illustration per setting. */
export function Backdrop({ setting, label }: { setting: string; label?: string }) {
  return (
    <svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice" className={styles.backdropSvg} aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fcdf2" />
          <stop offset="1" stopColor="#e3f4fb" />
        </linearGradient>
        <linearGradient id="warmWall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0e3c8" />
          <stop offset="1" stopColor="#d9c39c" />
        </linearGradient>
        <linearGradient id="coolWall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d6e2ee" />
          <stop offset="1" stopColor="#b4c6d8" />
        </linearGradient>
        <linearGradient id="lilacWall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#efe8f8" />
          <stop offset="1" stopColor="#d4c6ec" />
        </linearGradient>
        <linearGradient id="callTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5a4670" />
          <stop offset="1" stopColor="#2a2038" />
        </linearGradient>
        <pattern id="wood" width="24" height="240" patternUnits="userSpaceOnUse">
          <rect width="24" height="240" fill="#8a5630" />
          <rect width="11" height="240" fill="#9b6338" />
          <rect x="11" width="1.5" height="240" fill="#6e4224" />
        </pattern>
      </defs>

      {setting === "office" && (
        <g>
          <rect width="320" height="240" fill="url(#warmWall)" />
          <rect x="196" y="34" width="104" height="96" fill="url(#sky)" stroke="#7a5a3a" strokeWidth="5" />
          <g fill="#7f94ad">
            <rect x="200" y="96" width="16" height="32" />
            <rect x="220" y="80" width="18" height="48" />
            <rect x="242" y="90" width="14" height="38" />
            <rect x="260" y="70" width="20" height="58" />
            <rect x="282" y="94" width="14" height="34" />
          </g>
          <path d="M248 34 V130 M196 82 H300" stroke="#7a5a3a" strokeWidth="4" />
          <rect x="16" y="40" width="74" height="150" fill="#7a4f2a" stroke="#4d2f16" strokeWidth="3" />
          {[78, 116, 154].map((y) => (
            <rect key={y} x="16" y={y} width="74" height="5" fill="#4d2f16" />
          ))}
          {[
            [20, 50, "#d64545"], [30, 54, "#3d6fd6"], [40, 48, "#e0b33a"], [52, 56, "#3aa36b"], [62, 50, "#8a4fd6"], [74, 52, "#d67a3a"],
            [22, 90, "#3aa36b"], [34, 86, "#d64545"], [46, 92, "#3d6fd6"], [58, 88, "#e0b33a"], [70, 94, "#8a4fd6"],
            [24, 126, "#e0b33a"], [36, 130, "#3d6fd6"], [50, 124, "#d64545"], [64, 128, "#3aa36b"],
          ].map(([x, y, c]) => (
            <rect key={`${x}-${y}`} x={x as number} y={y as number} width="9" height={(y as number) % 2 ? 24 : 26} fill={c as string} stroke="#2a1a0c" strokeWidth="1" />
          ))}
          <circle cx="150" cy="44" r="16" fill="#fff" stroke="#4d2f16" strokeWidth="4" />
          <path d="M150 44 V34 M150 44 L157 48" stroke="#1b1b24" strokeWidth="2.5" />
          <rect x="152" y="132" width="24" height="26" fill="#b5532f" stroke="#5a2412" strokeWidth="2" />
          <g fill="#3f9a4f" stroke="#1f5a2a" strokeWidth="2">
            <ellipse cx="156" cy="118" rx="10" ry="18" transform="rotate(-25 156 118)" />
            <ellipse cx="172" cy="116" rx="10" ry="19" transform="rotate(25 172 116)" />
            <ellipse cx="164" cy="108" rx="9" ry="20" />
          </g>
        </g>
      )}

      {setting === "meeting-room" && (
        <g>
          <rect width="320" height="240" fill="url(#coolWall)" />
          <rect x="34" y="30" width="160" height="104" rx="4" fill="#fbfdff" stroke="#8796a8" strokeWidth="5" />
          <text x="48" y="52" fontSize="13" fontWeight="700" fill="#2a63d6" fontFamily="system-ui">Q4 TARGETS</text>
          <polyline points="50,118 80,100 104,108 132,78 162,64 182,46" fill="none" stroke="#d64545" strokeWidth="4" strokeLinejoin="round" />
          <path d="M176 44 L184 46 L180 54" fill="none" stroke="#d64545" strokeWidth="3" />
          <path d="M48 70 H120 M48 80 H100" stroke="#3aa36b" strokeWidth="3" />
          <rect x="212" y="26" width="92" height="120" fill="url(#sky)" stroke="#7d8ea0" strokeWidth="4" />
          {Array.from({ length: 11 }, (_, i) => (
            <rect key={i} x="212" y={30 + i * 10.5} width="92" height="5" fill="#e8eef4" opacity="0.85" />
          ))}
          <rect x="0" y="150" width="320" height="8" fill="#93a5b8" />
        </g>
      )}

      {setting === "reception" && (
        <g>
          <rect width="320" height="240" fill="url(#lilacWall)" />
          <rect x="96" y="36" width="128" height="52" rx="10" fill="#1b1e2b" />
          <text x="160" y="68" textAnchor="middle" fontSize="24" fontWeight="800" fill="#fff" fontFamily="system-ui" letterSpacing="1">mubit</text>
          <text x="160" y="81" textAnchor="middle" fontSize="7" fill="#b9a8ff" fontFamily="system-ui" letterSpacing="2">RELIABLE AGENTS</text>
          {[60, 160, 260].map((x) => (
            <g key={x}>
              <path d={`M${x} 0 V22`} stroke="#3b3550" strokeWidth="2" />
              <path d={`M${x - 12} 30 Q${x} 16 ${x + 12} 30 Z`} fill="#ffd166" stroke="#3b3550" strokeWidth="2" />
              <ellipse cx={x} cy="34" rx="18" ry="6" fill="#fff6c7" opacity="0.5" />
            </g>
          ))}
          {[30, 290].map((x) => (
            <g key={x}>
              <rect x={x - 12} y="126" width="24" height="30" fill="#f6f2fb" stroke="#6b5f86" strokeWidth="2" />
              <g fill="#4aa860" stroke="#22602f" strokeWidth="2">
                <ellipse cx={x - 8} cy="108" rx="9" ry="20" transform={`rotate(-20 ${x - 8} 108)`} />
                <ellipse cx={x + 8} cy="108" rx="9" ry="20" transform={`rotate(20 ${x + 8} 108)`} />
                <ellipse cx={x} cy="100" rx="8" ry="22" />
              </g>
            </g>
          ))}
        </g>
      )}

      {setting === "video-call" && (
        <g>
          <rect width="320" height="240" fill="#11131b" />
          <rect x="20" y="12" width="280" height="184" rx="12" fill="url(#callTile)" stroke="#3a3f55" strokeWidth="3" />
          <rect x="44" y="40" width="70" height="110" fill="#3a2c4c" opacity="0.8" />
          {[58, 84, 110].map((y) => (
            <rect key={y} x="44" y={y} width="70" height="3" fill="#251b33" />
          ))}
          <circle cx="36" cy="26" r="4" fill="#ff3b3b" className={styles.recDot} />
          <text x="44" y="29" fontSize="9" fontWeight="700" fill="#ff8080" fontFamily="system-ui">REC</text>
          {/* Caller name, top-right of the tile so the text box never covers it. */}
          <rect x={292 - Math.max(60, (label?.length ?? 14) * 6 + 18)} y="18" width={Math.max(60, (label?.length ?? 14) * 6 + 18)} height="16" rx="4" fill="rgba(0,0,0,0.55)" />
          <text x={300 - Math.max(60, (label?.length ?? 14) * 6 + 18)} y="29" fontSize="9" fill="#fff" fontFamily="system-ui">
            {label ?? "Unknown caller"}
          </text>
          <rect x="0" y="204" width="320" height="36" fill="#1b1e2b" />
          {[124, 160].map((x) => (
            <circle key={x} cx={x} cy="222" r="10" fill="#343a52" />
          ))}
          <circle cx="196" cy="222" r="10" fill="#e8413b" />
        </g>
      )}

      {setting === "courtroom" && (
        <g>
          <rect width="320" height="240" fill="url(#wood)" />
          {[40, 280].map((x) => (
            <g key={x}>
              <rect x={x - 16} y="0" width="32" height="240" fill="#6e4224" />
              <rect x={x - 12} y="0" width="6" height="240" fill="#8a5630" />
            </g>
          ))}
          <circle cx="160" cy="58" r="30" fill="#c99a3d" stroke="#5a3a12" strokeWidth="4" />
          <path d="M160 36 V82 M142 50 H178 M142 50 L134 66 H150 Z M178 50 L170 66 H186 Z" stroke="#5a3a12" strokeWidth="3" fill="#e7c46b" />
        </g>
      )}
    </svg>
  );
}

/**
 * The furniture in front of a sprite, drawn to match the Trilogy HD courtroom: the defense bench, the witness
 * stand, or the judge's bench. Sprites are cut off at the waist and rely on this to hide the edge.
 */
export function Desk({ kind }: { kind: "defense" | "witness" | "judge" }) {
  const cls = `${styles.deskSvg} ${kind === "defense" ? styles.deskDefense : kind === "witness" ? styles.deskWitness : styles.deskJudge}`;
  if (kind === "witness")
    return (
      <svg viewBox="0 0 300 60" preserveAspectRatio="none" className={cls} aria-hidden>
        <defs>
          <linearGradient id="standWood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a8682f" />
            <stop offset="1" stopColor="#5a3214" />
          </linearGradient>
        </defs>
        <path d="M58 60 L70 12 Q150 -2 230 12 L242 60 Z" fill="url(#standWood)" stroke="#2e1606" strokeWidth="2" />
        <path d="M70 12 Q150 -2 230 12 Q150 5 70 12 Z" fill="#e2a663" stroke="#2e1606" strokeWidth="1.5" />
        {[110, 150, 190].map((x) => (
          <path key={x} d={`M${x} 14 L${x + (x - 150) * 0.12} 60`} stroke="#3e200a" strokeWidth="2" opacity="0.6" />
        ))}
      </svg>
    );
  const top = kind === "judge" ? "#7a4520" : "#c98a46";
  const bottom = kind === "judge" ? "#2e1606" : "#5a3214";
  return (
    <svg viewBox="0 0 300 60" preserveAspectRatio="none" className={cls} aria-hidden>
      <defs>
        <linearGradient id={`${kind}Wood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={kind === "judge" ? "#6a3a18" : "#9a5d2c"} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect x="0" y="8" width="300" height="52" fill={`url(#${kind}Wood)`} />
      <rect x="0" y="0" width="300" height="9" fill={top} stroke="#2e1606" strokeWidth="1.5" />
      <rect x="0" y="8.5" width="300" height="1.5" fill="#ffd9a0" opacity="0.4" />
      {[50, 100, 150, 200, 250].map((x) => (
        <rect key={x} x={x - 1} y="12" width="2" height="48" fill="#2e1606" opacity="0.35" />
      ))}
      {kind === "judge" && <circle cx="150" cy="34" r="12" fill="#c99a3d" stroke="#5a3a12" strokeWidth="2" />}
    </svg>
  );
}

/** Spiky shout balloon points, deterministic. */
const BUBBLE = Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2;
  const r = i % 2 ? 0.74 + ((i * 7) % 5) * 0.025 : 1;
  return `${(200 + Math.cos(a) * 190 * r).toFixed(1)},${(110 + Math.sin(a) * 100 * r).toFixed(1)}`;
}).join(" ");

/** The OBJECTION! / HOLD IT! / TAKE THAT! balloon. */
export function ShoutBubble({ text, colour }: { text: string; colour: string }) {
  return (
    <svg viewBox="0 0 400 220" className={styles.bubbleSvg} aria-label={text} role="img">
      <polygon points={BUBBLE} fill="#fff" stroke={INK} strokeWidth="8" strokeLinejoin="round" />
      <text x="200" y="134" textAnchor="middle" className={styles.bubbleText} stroke={INK} strokeWidth="16" fill={INK} strokeLinejoin="round">
        {text}
      </text>
      <text x="200" y="134" textAnchor="middle" className={styles.bubbleText} stroke="#fff" strokeWidth="6" fill={colour} strokeLinejoin="round" paintOrder="stroke">
        {text}
      </text>
    </svg>
  );
}
