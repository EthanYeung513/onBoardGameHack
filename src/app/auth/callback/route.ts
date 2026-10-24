import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get("next") ?? "/studio";
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/studio";
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const sb = await supabaseServer();
  const { error } = code
    ? await sb.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await sb.auth.verifyOtp({ token_hash: tokenHash, type: type as "magiclink" | "email" })
      : { error: new Error("The sign-in link is missing its code") };
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
  return NextResponse.redirect(new URL(safe, url.origin));
}
