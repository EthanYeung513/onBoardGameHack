import Link from "next/link";

export function Header({ email, crumbs = [] }: { email?: string | null; crumbs?: Array<{ href?: string; label: string }> }) {
  return (
    <header className="border-b" style={{ borderColor: "var(--g-line)", background: "var(--g-surface)" }}>
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
        <Link href="/studio" className="font-bold" style={{ fontFamily: "var(--font-gen-display)" }}>
          Onboarding Studio
        </Link>
        <nav aria-label="Breadcrumb" className="g-muted flex min-w-0 items-center gap-2 text-sm">
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-2">
              <span aria-hidden>/</span>
              {c.href ? (
                <Link href={c.href} className="truncate hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/try" className="hover:underline">
            Constructor
          </Link>
          <Link href="/status" className="hover:underline">
            Service status
          </Link>
          {email && <span className="g-muted hidden sm:inline">{email}</span>}
          <form action="/auth/signout" method="post">
            <button className="g-btn g-btn-quiet py-1.5 text-sm" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
