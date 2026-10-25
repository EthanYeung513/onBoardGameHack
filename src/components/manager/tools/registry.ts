import type { ComponentType } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { ConnectorType } from "@convex/lib/connectors";
import { FilesConnect, WebappConnect } from "./FilesConnect";
import { GithubConnect } from "./GithubConnect";
import { DriveConnect, JiraConnect, NotionConnect, SlackConnect } from "./NangoConnect";

// Tools-tab registry: each connector type's label, priority and its card's connect control
// (rendered in the mockup's `.tool-card .st` slot). `TOOL_CARDS` is the mockup's OB.TOOLS list —
// order, names, icons and descriptions verbatim; types without a card (drive, linear, website)
// still sync but have no card in the mockup.

export type ToolEntry = { label: string; priority: "P0" | "P1" | "P2"; connect?: ComponentType<{ spaceId: Id<"spaces"> }> };

export const TOOL_REGISTRY: Record<ConnectorType, ToolEntry> = {
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

export const TOOL_CARDS: { id: ConnectorType; name: string; icon: string; desc: string }[] = [
  { id: "github", name: "GitHub", icon: "code", desc: "Repos, PRs, code review norms" },
  { id: "slack", name: "Slack", icon: "hash", desc: "Channels, jargon, rituals" },
  { id: "jira", name: "Jira", icon: "kanban", desc: "Boards, sprint cadence" },
  { id: "notion", name: "Notion", icon: "file", desc: "Wikis, handbooks, docs" },
  { id: "webapp", name: "Internal web app", icon: "globe", desc: "Agent browses & learns the tool" },
  { id: "files", name: "Upload docs", icon: "upload", desc: "PDFs, decks, local tools' docs" },
];
