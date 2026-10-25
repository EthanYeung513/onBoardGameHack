"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// The scan keeps running when the manager leaves its screen; this makes the way back explicit:
// a running scan → its live progress; a finished scan whose brand nobody reviewed → the theme
// cards built from the brand (D-34).

export function NextStepBanner({ spaceId }: { spaceId: Id<"spaces"> }) {
  const next = useQuery(api.scans.nextStep, { spaceId });
  if (!next) return null;
  const scanning = next.kind === "scanning";
  return (
    <div className="next-step" role="status">
      <span className={scanning ? "spin" : "dot"} aria-hidden />
      <span>{scanning ? "Your website scan is still running." : "Your brand is ready. Pick a theme for your space."}</span>
      <Link className="btn btn-primary" href={`/space/new?space=${spaceId}&scan=${next.scanId}`}>
        {scanning ? "View progress →" : "Pick your theme →"}
      </Link>
    </div>
  );
}
