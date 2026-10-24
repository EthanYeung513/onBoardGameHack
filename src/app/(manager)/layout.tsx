import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex/ConvexClientProvider";
import "./manager.css";

export const metadata: Metadata = {
  title: "Orthogonal",
  description: "AI-powered onboarding for your team, built from your company's own knowledge.",
};

// Manager surfaces (login, space creation, dashboard, brain, editor). Styling follows the mockup's
// styles.css, scoped under `.ob`; company colours come from the space's brand_profiles tokens.
export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthNextjsServerProvider>
      <ConvexClientProvider>
        <div className="ob">{children}</div>
      </ConvexClientProvider>
    </ConvexAuthNextjsServerProvider>
  );
}
