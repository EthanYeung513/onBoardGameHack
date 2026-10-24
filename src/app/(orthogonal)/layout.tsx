import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains" });

/** Orthogonal's fonts and dark canvas, kept to its own routes so the GymQuest pages are unaffected. */
export default function OrthogonalLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${hanken.variable} ${jetbrains.variable} min-h-screen bg-carbon font-grotesk text-white antialiased`}>{children}</div>;
}
