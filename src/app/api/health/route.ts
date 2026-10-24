import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { databaseKind, getDb } from "@/db/client";
import { getLlm } from "@/llm";

export const dynamic = "force-dynamic";

/** Connection strings never leave the server, even inside driver error messages. */
const redact = (message: string) => message.replace(/postgres(ql)?:\/\/\S+/g, "<database url>");

/** Deployment check: which database and LLM are configured, and whether the database answers. No secrets. */
export async function GET() {
  const env = { DATABASE_URL: Boolean(process.env.DATABASE_URL), POSTGRES_URL: Boolean(process.env.POSTGRES_URL), MUBIT_API_KEY: Boolean(process.env.MUBIT_API_KEY) };
  const base = { db: databaseKind(), llm: getLlm().mode, env };
  try {
    const db = await getDb();
    const [row] = (await db.execute(sql`select count(*)::int as cards from cards`)) as unknown as { cards: number }[];
    return NextResponse.json({ ok: true, ...base, cards: row?.cards ?? null });
  } catch (err) {
    return NextResponse.json({ ok: false, ...base, error: redact((err as Error).message), cause: redact(String((err as { cause?: unknown }).cause ?? "")) }, { status: 503 });
  }
}
