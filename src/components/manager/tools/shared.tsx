"use client";

import { useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { createContext, useContext } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ConnectorType } from "@convex/lib/connectors";

// Shared by the Tools-tab connect components: the connector row (reactive), the mockup's toast,
// and the card's status slot (`.st`): "Connected ✓" pill when synced, otherwise the Connect button.

export const ToastContext = createContext<(text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function useConnector(spaceId: Id<"spaces">, type: ConnectorType) {
  const data = useQuery(api.connectors.list, { spaceId });
  return data?.connectors.find((c) => c.type === type) ?? null;
}

export function errorText(e: unknown): string {
  if (e instanceof ConvexError) return (e.data as { message?: string })?.message ?? "Something went wrong";
  return e instanceof Error ? e.message : String(e);
}

export function lastSynced(at: number | null): string {
  if (!at) return "Not synced yet";
  const mins = Math.round((Date.now() - at) / 60_000);
  return `Last synced ${mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}`;
}

type View = ReturnType<typeof useConnector>;

/** The card's right-hand slot. `button` is the tool's own Connect control. */
export function StatusSlot({ connector, button }: { connector: View; button: React.ReactNode }) {
  if (connector?.connected && connector.status === "ready") {
    return (
      <span className="pill live" title={lastSynced(connector.lastSyncedAt)}>
        Connected ✓
      </span>
    );
  }
  if (connector?.connected && (connector.status === "syncing" || connector.status === "stale")) {
    return (
      <span className="pill inv" title={lastSynced(connector.lastSyncedAt)}>
        Syncing…
      </span>
    );
  }
  return <>{button}</>;
}
