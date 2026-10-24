// Copy and media for the landing page, mirroring the Webflow export on `main` (index.html, now at /classic).

export const LINKS = {
  build: "/login?next=/space/new",
  login: "/login",
  demo: "/try",
  video: "https://www.youtube.com/watch?v=JwTvTwcPmFk",
} as const;

export const NAV = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#about", label: "About" },
];

type Tile = { src: string; alt: string; video?: string; tone: "light" | "dark" | "blue" | "red" | "yellow" };

/** Hero mosaic: five columns of two tiles; odd columns sit lower, like the original grid. */
export const HERO_COLUMNS: Tile[][] = [
  [
    { src: "/landing/grid-upload.webp", alt: "Upload Material interface with DOC, PPT, YouTube and PDF icons.", tone: "light" },
    { src: "/landing/grid-level.png", alt: "Game mode unlocked notification: get to the next level.", tone: "yellow" },
  ],
  [
    {
      src: "/landing/game-road.jpg",
      video: "/landing/game-road.mp4",
      alt: "Orthogonal racing minigame with a lesson card titled 'The Genesis of the Nobel Prize', 0/100 XP.",
      tone: "dark",
    },
    { src: "/landing/grid-modules.webp", alt: "Learning modules: 'Teach the beginning Roman Empire' and 'Ancient Roman Society'.", tone: "blue" },
  ],
  [
    { src: "/landing/grid-forbes.png", alt: "Forbes feature card.", tone: "red" },
    { src: "/landing/grid-xp.webp", alt: "Analytics bar chart showing 40 XP earned today.", tone: "light" },
  ],
  [
    {
      src: "/landing/game-room.jpg",
      video: "/landing/game-room.mp4",
      alt: "Isometric room with a sign reading 'Means better retention'.",
      tone: "red",
    },
    { src: "/landing/grid-reward.webp", alt: "Reward card: a coffee voucher for 120 coins.", tone: "dark" },
  ],
  [
    { src: "/landing/grid-roi.svg", alt: "ROI forecast with three hires along a rising curve.", tone: "light" },
    { src: "/landing/grid-pencil.webp", alt: "Smiling pencil character with a voice recording bar.", tone: "yellow" },
  ],
];

export type Actor = "Company" | "Orthogonal" | "Employee";

export const STEPS: { actor: Actor; title: string; body: string; img: string; alt: string }[] = [
  {
    actor: "Company",
    title: "Connect your stack",
    body: "Slack, GitHub, Jira, wikis and docs are linked — agents learn who knows what, the jargon, the rituals.",
    img: "/landing/how-1.png",
    alt: "Upload interface with DOC, PPT and PDF files around a cloud symbol.",
  },
  {
    actor: "Orthogonal",
    title: "The Brain builds your world",
    body: "A company knowledge graph, a curriculum, and custom minigames — generated for every new hire.",
    img: "/landing/how-2.png",
    alt: "Three minigame cards: Scenarios, Speedy and Rooms.",
  },
  {
    actor: "Employee",
    title: "Explore the world",
    body: "New hires walk a pixel village, meet NPC coworkers, and play to unlock each building.",
    img: "/landing/how-3.png",
    alt: "Isometric robot character in a blue room next to a lesson card.",
  },
  {
    actor: "Company",
    title: "Manage insights",
    body: "Agents track knowledge gaps and progress, and suggest what to teach next.",
    img: "/landing/how-4.png",
    alt: "ROI forecast curve with three hires and a target of 84%.",
  },
  {
    actor: "Orthogonal",
    title: "Adapts to every hire",
    body: "Difficulty, pacing and content adjust automatically to every individual hire.",
    img: "/landing/how-5.png",
    alt: "Bar chart with 'Today 40 XP earned' highlighted.",
  },
  {
    actor: "Employee",
    title: "Redeem rewards",
    body: "Progress earns Coins, redeemable for real perks in the Orthogonal shop.",
    img: "/landing/how-6.png",
    alt: "Notification: +50 points, rewards unlocked, redeem voucher.",
  },
];

export const FEATURES = [
  "Turns your company's tribal knowledge into a playable world. No course authoring, no maintenance.",
  "Onboarding agents continuously adapt difficulty, pacing and focus areas based on real behavior.",
  "Progress generates Coins that can be used in the Orthogonal shop. Rewards reinforce engagement over time.",
  "Real-time visibility into engagement, progress and knowledge gaps – without manual reporting.",
  "A world that grows with your curriculum — every course becomes a building. Fast setup, minimal admin.",
];

export const FEATURE_SHOTS = [
  { src: "/landing/feature-dashboard.webp", alt: "Manager dashboard with team onboarding progress", label: "Dashboard" },
  { src: "/landing/feature-gate.webp", alt: "Player login gate for new hires", label: "Hire login" },
  { src: "/landing/feature-world.webp", alt: "Game world with buildings and NPCs", label: "World" },
];
