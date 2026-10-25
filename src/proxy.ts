import { convexAuthNextjsMiddleware, createRouteMatcher, nextjsMiddlewareRedirect } from "@convex-dev/auth/nextjs/server";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Manager surfaces sign in with Convex Auth. The legacy studio (`/studio`, `/admin`, `/api/gen/*`)
// still sits behind Supabase until it is migrated; everything else (landing, published flows,
// the public constructor, play) is public.

const MANAGER = createRouteMatcher(["/space(.*)", "/dashboard(.*)", "/brain(.*)", "/editor(.*)", "/course(.*)"]);
const LEGACY = [/^\/studio(\/|$)/, /^\/admin(\/|$)/, /^\/status(\/|$)/, /^\/preview(\/|$)/, /^\/api\/gen\//, /^\/api\/admin\//];
const LEGACY_PUBLIC = [/^\/api\/gen\/leads$/, /^\/api\/gen\/pipeline\//, /^\/api\/gen\/flows\/[^/]+\/public$/];

async function legacyGate(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return new NextResponse("Supabase is not configured", { status: 503 });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    return nextjsMiddlewareRedirect(request, `/login?next=${encodeURIComponent(request.nextUrl.pathname)}`);
  }
  return response;
}

const convexProxy = convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const path = request.nextUrl.pathname;
  if (MANAGER(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, `/login?next=${encodeURIComponent(path + request.nextUrl.search)}`);
  }
  if (LEGACY.some((r) => r.test(path)) && !LEGACY_PUBLIC.some((r) => r.test(path))) return legacyGate(request);
});

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    const path = request.nextUrl.pathname;
    if (MANAGER(request) || path === "/login" || path.startsWith("/api/auth")) {
      return new NextResponse("Convex is not configured — run `npm run dev`, which boots the local backend.", { status: 503 });
    }
    if (LEGACY.some((r) => r.test(path)) && !LEGACY_PUBLIC.some((r) => r.test(path))) return legacyGate(request);
    return NextResponse.next();
  }
  return convexProxy(request, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|ico|mp4|webm|woff2?|ttf|css|js)$).*)"],
};
