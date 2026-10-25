"use client";

import { useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { createContext, useContext, useEffect } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ConnectorType } from "@convex/lib/connectors";

// Shared by the Tools-tab connector pages: the connector row (reactive), the dashboard toast, and
// the mockup's `.overlay > .modal` (styles.css) every card opens.

export const ToastContext = createContext<(text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

/** What every connector page receives from its card. */
export type PanelProps = { spaceId: Id<"spaces">; open: boolean; onClose: () => void };

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

/** The mockup's modal: click outside, × or Escape closes it. */
export function Modal({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <div className={`overlay${open ? " open" : ""}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
          <button type="button" className="x" aria-label="Close" onClick={onClose}>
            ×
          </button>
          {children}
        </div>
      )}
    </div>
  );
}

/** One line under the modal title: who is connected and when it last synced. */
export function ConnectionLine({ spaceId, type }: { spaceId: Id<"spaces">; type: ConnectorType }) {
  const c = useConnector(spaceId, type);
  if (!c?.connected) return null;
  const text = c.status === "error" ? (c.error ?? "Sync failed") : [c.label ? `Connected to ${c.label}` : "Connected", lastSynced(c.lastSyncedAt)].join(" · ");
  return <p className={`conn-line${c.status === "error" ? " err" : ""}`}>{text}</p>;
}
