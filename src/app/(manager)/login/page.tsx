import { LoginCard } from "./LoginCard";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only same-origin paths are honoured as redirect targets.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  return <LoginCard next={safeNext} />;
}
