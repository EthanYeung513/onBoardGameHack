import { NextResponse } from "next/server";
import { DEMO_SITE, normaliseSiteUrl } from "@/lib/orthogonal/site";
import { currentUser } from "@/lib/supabase/server";

/** The live backend needs Supabase; without it, and for the Lumen demo site, the mock answers. */
export function liveBackend(siteInput?: string): boolean {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return configured && (siteInput === undefined || normaliseSiteUrl(siteInput) !== DEMO_SITE);
}

export async function requireUserId(): Promise<string | NextResponse> {
  const user = await currentUser();
  return user ? user.id : NextResponse.json({ error: "Sign in required" }, { status: 401 });
}

/** Mock project and scan ids are short slugs; live ones are UUIDs. */
export const isLiveId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
