import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Resolves the signed in user and checks they own the project. */
export async function requireProject(projectId: string) {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in required");
  const { data, error } = await supabaseAdmin().from("projects").select().eq("id", projectId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data || data.created_by !== user.id) throw new HttpError(404, "Project not found");
  return { user, project: data };
}

export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err) => {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  });
}
