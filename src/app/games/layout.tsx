import { Pixelify_Sans, VT323 } from "next/font/google";

// Game fonts load here, not in the game components, so the components stay testable outside Next.
const terminal = VT323({ weight: "400", subsets: ["latin"], variable: "--font-game-text" });
const pixelSans = Pixelify_Sans({ subsets: ["latin"], variable: "--font-game-sans" });

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${terminal.variable} ${pixelSans.variable}`}>{children}</div>;
}
