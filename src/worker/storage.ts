import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { USER_AGENT } from "@/lib/crawl/fetch";
import type { StageContext } from "./types";

// Copies bytes (screenshots, logos) into Convex file storage via a worker-issued upload URL, so
// stored assets survive the source site changing (skills/extract-brand-tokens step 5).

export async function storeBytes(ctx: Pick<StageContext, "convex">, bytes: Uint8Array, contentType: string) {
  const uploadUrl = await ctx.convex.mutation(api.scanWorker.generateUploadUrl, {});
  const res = await fetch(uploadUrl, { method: "POST", headers: { "content-type": contentType }, body: bytes as BodyInit, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`storage upload failed: HTTP ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  const url = await ctx.convex.mutation(api.scanWorker.storageUrl, { storageId });
  return { storageId, url: url ?? "" };
}

const FORMATS: Record<string, string> = { "image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico" };

/** Resolve a remote URL or a data: URI to image bytes. */
export async function loadImage(src: string): Promise<{ bytes: Uint8Array; contentType: string; format: string }> {
  let bytes: Uint8Array;
  let contentType: string;
  const data = src.match(/^data:([^;,]+)(;base64)?(?:;[^,]*)?,(.*)$/s);
  if (data) {
    contentType = data[1];
    bytes = data[2] ? Buffer.from(data[3], "base64") : new TextEncoder().encode(decodeURIComponent(data[3]));
  } else {
    const res = await fetch(src, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  if (!contentType.startsWith("image/")) throw new Error(`not an image (${contentType || "unknown type"})`);
  if (bytes.byteLength > 2_000_000) throw new Error("image larger than 2 MB");
  return { bytes, contentType, format: FORMATS[contentType] ?? contentType.replace("image/", "") };
}
