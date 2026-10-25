import type { Metadata } from "next";
import { Press_Start_2P } from "next/font/google";
import "./globals.css";

const pixel = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-pixel-face" });

export const metadata: Metadata = {
  title: { default: "Orthogonal", template: "%s · Orthogonal" },
  description: "Onboarding for any role, played as a game. Every expert correction becomes a model update.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pixel.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
