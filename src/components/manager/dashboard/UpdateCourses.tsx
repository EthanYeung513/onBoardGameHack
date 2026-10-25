"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

/**
 * D-36: Mubit's loop detected company changes and refreshed course steps since the last push.
 * The manager decides: one click pushes them to the same deployment (same link and QR). Never
 * automatic. Renders nothing when there is nothing new or the world isn't published yet.
 */
export function UpdateCoursesButton({ spaceId, onDone }: { spaceId: Id<"spaces">; onDone?: (msg: string) => void }) {
  const pending = useQuery(api.deploy.pendingUpdates, { spaceId });
  const deploy = useMutation(api.deploy.deployOnboarding);
  const [busy, setBusy] = useState(false);
  if (!pending || pending.changed.length === 0) return null;
  const working = busy || pending.building;
  return (
    <button
      className="btn btn-primary"
      id="update-courses"
      disabled={working}
      title={pending.changed.map((c) => c.title).join(", ")}
      onClick={async () => {
        setBusy(true);
        try {
          await deploy({ spaceId });
          onDone?.("Updating your onboarding world");
        } catch (err) {
          onDone?.(err instanceof ConvexError ? (err.data as { message: string }).message : "Couldn't update. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {working ? "Updating…" : "Update courses"}
    </button>
  );
}

/** How many courses changed since the last push, for the banner line. */
export function usePendingUpdates(spaceId: Id<"spaces">) {
  return useQuery(api.deploy.pendingUpdates, { spaceId });
}
