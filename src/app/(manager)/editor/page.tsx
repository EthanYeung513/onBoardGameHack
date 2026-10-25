"use client";

import { useQueries, useQuery, type RequestForQueries } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { brandFns, type BrandOptions } from "@/components/editor/contracts";
import { Editor } from "@/components/editor/Editor";
import "./editor.css";

// /editor?space=<id>[&course=<id>] — editor.html. The scan screen lands here after a successful scan.
function EditorRoute() {
  const params = useSearchParams();
  const router = useRouter();
  const spaceId = params.get("space") as Id<"spaces"> | null;
  const courseId = (params.get("course") as Id<"courses"> | null) ?? undefined;
  const data = useQuery(api.editor.load, spaceId ? { spaceId, courseId } : "skip");
  const assets = useQuery(api.editor.assets, spaceId ? { spaceId } : "skip");
  // useQueries returns an Error instead of throwing, so the Design tab degrades to the brand tokens
  // when brand learning (convex/brand.ts) isn't deployed — see components/editor/contracts.ts.
  // (The request object must be stable across renders — useQueries resubscribes on a new one.)
  const brandQuery = useMemo((): RequestForQueries => (spaceId ? { options: { query: brandFns.options, args: { spaceId } } } : {}), [spaceId]);
  const brand = useQueries(brandQuery);
  const options: BrandOptions | null | undefined = brand.options instanceof Error ? null : (brand.options as BrandOptions | null | undefined);

  useEffect(() => {
    if (!spaceId) router.replace("/dashboard");
  }, [spaceId, router]);

  if (!spaceId || !data) return <div className="ed" />;
  return <Editor spaceId={spaceId} data={data} assets={assets} options={options} />;
}

export default function EditorPage() {
  return (
    <Suspense fallback={<div className="ed" />}>
      <EditorRoute />
    </Suspense>
  );
}
