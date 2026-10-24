import type { Metadata } from "next";
import "./site.css";

export const metadata: Metadata = {
  title: "Orthogonal — Make onboarding fun!",
  description: "Fully game-based onboarding platform. AI-native. Agent-driven. Hyper-personalized to your company.",
  icons: { icon: "/landing/favicon-256.png" },
};

/** Orthogonal's own marketing palette and type, scoped to the landing page so other routes are unaffected. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <div className="site">{children}</div>;
}
