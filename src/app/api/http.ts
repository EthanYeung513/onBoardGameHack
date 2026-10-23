import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, NotFoundError } from "@/services/grading";

/** Runs a route handler body and maps known errors to HTTP status codes. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    if (err instanceof BadRequestError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
