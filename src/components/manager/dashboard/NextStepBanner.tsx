"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// The scan keeps running when the manager leaves its screen; this makes the way back explicit:
// a running scan → its live progress; a finished scan whose brand nobody reviewed → the editor's
// Design tab (recommended options first).

export function NextStepBanner({ spaceId }: { spaceId: Id<"spaces"> }) {
  const next = useQuery(api.scans.nextStep, { spaceId });
  if (!next) return null;
  const scanning = next.kind === "scanning";
  return (
    <div className="next-step" role="status">
      <span className={scanning ? "spin" : "dot"} aria-hidden />
      <span>{scanning ? "Your website scan is still running." : "Your brand is ready — review the recommended design for your space."}</span>
      <Link className="btn btn-primary" href={scanning ? `/space/new?space=${spaceId}&scan=${next.scanId}` : `/editor?space=${spaceId}&panel=design`}>
        {scanning ? "View progress →" : "Pick your design →"}
      </Link>
    </div>
  );
}
