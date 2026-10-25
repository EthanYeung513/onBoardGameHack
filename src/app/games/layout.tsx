import { Anton, M_PLUS_Rounded_1c, Pixelify_Sans, VT323 } from "next/font/google";

// Game fonts load here, not in the game components, so the components stay testable outside Next.
const terminal = VT323({ weight: "400", subsets: ["latin"], variable: "--font-game-text" });
// Closest open-licensed match to the Gen 4/5 Pokémon text face: a proportional pixel font.
const pokemon = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pokemon" });
// Ace Attorney Trilogy's dialogue face is a rounded gothic (Rodin-style); M PLUS Rounded is its open twin.
const courtroom = M_PLUS_Rounded_1c({ weight: ["500", "700", "800"], subsets: ["latin"], variable: "--font-courtroom" });
// Ace Attorney's shouts, banners and verdicts are set in Impact, which most Linux and Android devices lack; Anton is its open twin.
const impact = Anton({ weight: "400", subsets: ["latin"], variable: "--font-impact" });

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${terminal.variable} ${pokemon.variable} ${courtroom.variable} ${impact.variable}`}>{children}</div>;
}
