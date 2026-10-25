import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex/ConvexClientProvider";
import "./login/login.css";

export const metadata: Metadata = { title: "Log in — Orthogonal" };

// Sign-in pages follow login.html, which has its own stylesheet (not the mockup's styles.css).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthNextjsServerProvider>
      <ConvexClientProvider>{children}</ConvexClientProvider>
    </ConvexAuthNextjsServerProvider>
  );
}
