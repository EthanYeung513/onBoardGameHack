import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

export type Space = NonNullable<FunctionReturnType<typeof api.spaces.get>>;
export type Toast = (text: string) => void;
export type TabProps = { space: Space; toast: Toast };

export const TABS = ["overview", "courses", "tools", "team", "analytics", "rewards", "settings"] as const;
export type Tab = (typeof TABS)[number];

/** The Convex error's readable message (BUILD-CONTRACT error shape), or a generic fallback. */
export function errMsg(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ConvexError) return (err.data as { message?: string })?.message ?? fallback;
  return fallback;
}

/** Two-letter avatar text, as the mockup's `h.name.slice(0,2).toUpperCase()`. */
export const avatarText = (name: string) => name.slice(0, 2).toUpperCase();

export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
