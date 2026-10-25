// Step 2 of scripts/capture-landing-media.mjs: cut/crop/compose the raw gameplay recordings into the landing
// slots (all 4:5, matching the mockup art they replace) and encode H.264 mp4 + VP9 webm + JPG poster.
// Every pixel of game footage comes from the raw recordings; the only non-game layers are the mockup's own
// card frames (the Game-07 phone frame for "Why Orthogonal", plain white canvas for the How-it-works tabs).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = "public/assets/media";
const PHONE_FRAME = "public/assets/69a74ae2310e4bb7e044993b_Game-07.mp4"; // the mockup card's phone frame

const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });

/** Alpha mask expression for a rounded rectangle of radius r (for geq on a gray canvas). */
const rounded = (r) => `255*lte(hypot(max(0,max(${r}-X,X-(W-1-${r}))),max(0,max(${r}-Y,Y-(H-1-${r})))),${r})`;

/** Encodes an intermediate (lossless-ish) file into the three delivery formats. */
function deliver(src, name, { crf = 27, vp9 = 38 } = {}) {
  const base = join(OUT, name);
  ff(["-i", src, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${base}.mp4`]);
  ff(["-i", src, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(vp9), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", `${base}.webm`]);
  ff(["-i", src, "-frames:v", "1", "-q:v", "4", `${base}.jpg`]);
  const kb = (f) => Math.round(statSync(f).size / 1024);
  console.log(`${name}: mp4 ${kb(`${base}.mp4`)} KB, webm ${kb(`${base}.webm`)} KB, poster ${kb(`${base}.jpg`)} KB`);
}

const tmp = (n) => join("/tmp", `landing-media-${n}.mkv`);
const LOSSLESS = ["-c:v", "libx264", "-crf", "10", "-preset", "veryfast", "-pix_fmt", "yuv420p"];

export async function encodeAll(raw) {
  mkdirSync(OUT, { recursive: true });
  const m = (name) => JSON.parse(readFileSync(join(raw, `${name}.json`), "utf8")).marks;
  const v = (name) => join(raw, `${name}.webm`);
  const dil = m("dilemma"), bat = m("battle"), wm = m("word-match"), talk = m("world-talk");

  // Stage crops (CSS px of the recording viewports).
  const DILEMMA_STAGE_45 = "crop=550:688:365:16"; // 1280x720: centre of the 16:9 courtroom stage
  const DILEMMA_NO_TEXTBOX = "crop=1036:462:122:16"; // stage above the dialogue box
  const BATTLE_45 = "crop=720:900:90:0"; // 900x900: battle card
  const BATTLE_SCENE = "crop=826:378:38:78"; // sprites + HP boxes, no textbox / move panel
  const WORDMATCH_NO_HINT = "crop=700:548:10:142"; // 720x900: header + board, no hint bar
  const LEN = 6;

  // 1. Hero tile: the dilemma - choices, OBJECTION!, the caller folds.
  ff(["-ss", String(dil.pick - 1), "-t", String(LEN), "-i", v("dilemma"), "-vf", `${DILEMMA_STAGE_45},scale=576:720:flags=lanczos,fps=30`, ...LOSSLESS, tmp("hero")]);
  deliver(tmp("hero"), "hero-dilemma");

  // 2. Why Orthogonal card: the mockup's phone frame with our Stardew-style town inside - walk up, talk.
  const talkStart = talk.talk - 3;
  ff([
    "-ss", "2", "-i", PHONE_FRAME,
    "-ss", String(talkStart), "-t", String(LEN), "-i", v("world-talk"),
    "-filter_complex",
    "[0:v]trim=end_frame=1,scale=800:1000,loop=loop=-1:size=1,fps=30,trim=duration=" + LEN + ",setpts=PTS-STARTPTS[bg];" +
      "[1:v]scale=508:-2:flags=lanczos,crop=508:774:0:0,fps=30,setpts=PTS-STARTPTS[g];" +
      "[bg][g]overlay=146:226:shortest=1",
    ...LOSSLESS, tmp("why"),
  ]);
  deliver(tmp("why"), "why-world-talk", { crf: 31, vp9: 44 });

  // 3. "The Brain builds your world": three overlapping game cards (gameplay only), like the How_02 art.
  const card = (input, crop, w, h) =>
    `[${input}:v]${crop},scale=${w}:${h}:flags=lanczos,fps=30,setpts=PTS-STARTPTS,format=yuva420p[c${input}];` +
    `color=white:s=${w}x${h}:d=${LEN},format=gray,geq=lum='${rounded(18)}'[m${input}];` +
    `[c${input}][m${input}]alphamerge[r${input}];` +
    `color=0xc9c9c9:s=${w + 4}x${h + 4}:d=${LEN},format=yuva420p[b${input}];` +
    `color=white:s=${w + 4}x${h + 4}:d=${LEN},format=gray,geq=lum='${rounded(20)}'[bm${input}];` +
    `[b${input}][bm${input}]alphamerge[br${input}];` +
    `[br${input}][r${input}]overlay=2:2[k${input}];`;
  ff([
    "-ss", String(dil.pick - 2.4), "-t", String(LEN), "-i", v("dilemma"),
    "-ss", String(bat.pick - 1.2), "-t", String(LEN), "-i", v("battle"),
    "-ss", String(wm.board + 1.6), "-t", String(LEN), "-i", v("word-match"),
    "-filter_complex",
    card(0, DILEMMA_NO_TEXTBOX, 610, 272) +
      card(1, BATTLE_SCENE, 590, 270) +
      card(2, WORDMATCH_NO_HINT, 600, 470) +
      `color=white:s=1024x1280:d=${LEN}:r=30[bg];` +
      "[bg][k0]overlay=150:170[o0];[o0][k2]overlay=100:690[o1];[o1][k1]overlay=340:420:shortest=1,scale=800:1000:flags=lanczos",
    ...LOSSLESS, tmp("brain"),
  ]);
  deliver(tmp("brain"), "brain-games", { crf: 28, vp9: 40 });

  // 4. "Explore the world": the How_03 pose - our hire standing at a course building, its course tooltip as the card.
  {
    const { tip, me } = JSON.parse(readFileSync(join(raw, "world-explore.json"), "utf8"));
    const k = 1.24; // zoom the town a touch so the hire reads at the original art's scale
    const below = Math.ceil((tip.y + tip.height + 6) * k); // start the view under the in-game tooltip (it moves to the card)
    const x = Math.max(0, Math.round(me.x * k - 314));
    ff([
      "-i", join(raw, "world-explore.png"),
      "-filter_complex",
      "[0:v]split[a][b];" +
        `[a]scale=iw*${k}:-2:flags=neighbor,crop=628:1108:${x}:${below},format=yuva420p[w];` +
        `color=white:s=628x1108,format=gray,geq=lum='if(gt(Y,100),255,${rounded(100)})'[wm];` +
        "[w][wm]alphamerge[wr];" +
        `[b]crop=${Math.round(tip.width)}:${Math.round(tip.height)}:${Math.round(tip.x)}:${Math.round(tip.y)},scale=500:-2:flags=neighbor[tip];` +
        "color=white:s=1024x1280[bg];[bg][wr]overlay=250:172[o];[o][tip]overlay=128:860",
      "-frames:v", "1", "-c:v", "libwebp", "-quality", "86", join(OUT, "explore-world.webp"),
    ]);
    console.log(`explore-world.webp: ${Math.round(statSync(join(OUT, "explore-world.webp")).size / 1024)} KB`);
  }

  // 5. Agent-driven features slider: one game per slide, so the autoplaying slider is a gameplay montage.
  ff(["-ss", String(dil.choices - 6), "-t", String(LEN), "-i", v("dilemma"), "-vf", `${DILEMMA_STAGE_45},scale=576:720:flags=lanczos,fps=30`, ...LOSSLESS, tmp("a1")]);
  deliver(tmp("a1"), "agents-dilemma");
  ff(["-ss", String(bat.pick - 1.5), "-t", String(LEN), "-i", v("battle"), "-vf", `${BATTLE_45},scale=576:720:flags=lanczos,fps=30`, ...LOSSLESS, tmp("a2")]);
  deliver(tmp("a2"), "agents-battle");
  ff(["-ss", String(wm.board + 1), "-t", String(LEN), "-i", v("word-match"), "-vf", "scale=576:720:flags=lanczos,fps=30", ...LOSSLESS, tmp("a3")]);
  deliver(tmp("a3"), "agents-word-match");
}
