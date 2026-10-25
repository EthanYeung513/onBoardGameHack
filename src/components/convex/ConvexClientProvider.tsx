"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const client = url ? new ConvexReactClient(url) : null;

/** Convex + Convex Auth for the manager surfaces. Without a deployment URL nothing can work, so say so. */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!client) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Convex is not configured</h1>
        <p>
          Set <code>NEXT_PUBLIC_CONVEX_URL</code> in <code>.env.local</code> — run <code>npm run dev</code>, which boots the
          local Convex backend and fills it in.
        </p>
      </div>
    );
  }
  return <ConvexAuthNextjsProvider client={client}>{children}</ConvexAuthNextjsProvider>;
}
