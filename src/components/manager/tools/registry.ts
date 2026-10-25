import type { ComponentType } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { ConnectorType } from "@convex/lib/connectors";
import { FilesConnect, WebappConnect } from "./FilesConnect";
import { GithubConnect } from "./GithubConnect";
import { DriveConnect, JiraConnect, NotionConnect, SlackConnect } from "./NangoConnect";

// The Tools tab's cards (mockup `OB.TOOLS`, same order, names, icons and copy) and each card's
// real Connect control (S6/S7/S15). Nango-backed controls show their own honest "needs Nango
// integration setup" state until that integration exists — never a simulated connection.

export type ToolType = "github" | "slack" | "jira" | "notion" | "webapp" | "files";

export type ToolEntry = {
  type: ToolType;
  name: string;
  icon: string;
  desc: string;
  /** Renders the real Connect control for this tool (OAuth button, PAT form, upload…). */
  connect?: ComponentType<{ spaceId: Id<"spaces"> }>;
  /** Tooltip on the disabled Connect button while `connect` is missing. */
  pending?: string;
};

export const TOOLS: ToolEntry[] = [
  { type: "github", name: "GitHub", icon: "code", desc: "Repos, PRs, code review norms", connect: GithubConnect },
  { type: "slack", name: "Slack", icon: "hash", desc: "Channels, jargon, rituals", connect: SlackConnect },
  { type: "jira", name: "Jira", icon: "kanban", desc: "Boards, sprint cadence", connect: JiraConnect },
  { type: "notion", name: "Notion", icon: "file", desc: "Wikis, handbooks, docs", connect: NotionConnect },
  { type: "webapp", name: "Internal web app", icon: "globe", desc: "Agent browses & learns the tool", connect: WebappConnect },
  { type: "files", name: "Upload docs", icon: "upload", desc: "PDFs, decks, local tools' docs", connect: FilesConnect },
];

/** Every connector type (incl. ones without a mockup card) → label, priority, connect control. */
export type RegistryEntry = { label: string; priority: "P0" | "P1" | "P2"; connect?: ComponentType<{ spaceId: Id<"spaces"> }> };

export const TOOL_REGISTRY: Record<ConnectorType, RegistryEntry> = {
  github: { label: "GitHub", priority: "P0", connect: GithubConnect },
  files: { label: "Upload docs", priority: "P0", connect: FilesConnect },
  slack: { label: "Slack", priority: "P1", connect: SlackConnect },
  jira: { label: "Jira", priority: "P1", connect: JiraConnect },
  notion: { label: "Notion", priority: "P1", connect: NotionConnect },
  drive: { label: "Google Drive", priority: "P1", connect: DriveConnect },
  webapp: { label: "Internal web app", priority: "P2", connect: WebappConnect },
  linear: { label: "Linear", priority: "P2" },
  website: { label: "Website", priority: "P0" },
};

export const TOOL_CARDS = TOOLS.map((t) => ({ id: t.type as ConnectorType, name: t.name, icon: t.icon, desc: t.desc }));
