import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Stored screenshots as image blocks for a model call, homepage first. */
export async function screenshotBlocks(db: SupabaseClient, projectId: string, max = 3): Promise<{ blocks: Anthropic.ImageBlockParam[]; urls: string[] }> {
  const { data } = await db.from("assets").select("storage_path, source_url, created_at").eq("project_id", projectId).eq("kind", "screenshot").order("created_at").limit(max);
  const blocks: Anthropic.ImageBlockParam[] = [];
  const urls: string[] = [];
  for (const a of data ?? []) {
    const file = await db.storage.from("screenshots").download(a.storage_path);
    if (file.error || !file.data) continue;
    const buf = Buffer.from(await file.data.arrayBuffer());
    const mediaType = buf[0] === 0x89 ? "image/png" : "image/jpeg";
    blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } });
    urls.push(a.source_url);
  }
  return { blocks, urls };
}

export async function signedScreenshotUrl(db: SupabaseClient, path: string, seconds = 3600): Promise<string | null> {
  const { data } = await db.storage.from("screenshots").createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
