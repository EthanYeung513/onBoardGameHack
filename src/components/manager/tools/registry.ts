import type { ComponentType } from "react";
import type { Id } from "@convex/_generated/dataModel";

// The Tools tab's cards (mockup `OB.TOOLS`, same order, names, icons and copy). Each connector PR
// registers its Connect flow here by adding `connect`; until then the card keeps the mockup's
// Connect button, disabled with a "Coming soon" tooltip — never a simulated connection.

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

/** Nango has only a GitHub integration configured (check:env, #11); the others need one first. */
const NANGO_PENDING = "Needs Nango integration setup";

export const TOOLS: ToolEntry[] = [
  { type: "github", name: "GitHub", icon: "code", desc: "Repos, PRs, code review norms" },
  { type: "slack", name: "Slack", icon: "hash", desc: "Channels, jargon, rituals", pending: NANGO_PENDING },
  { type: "jira", name: "Jira", icon: "kanban", desc: "Boards, sprint cadence", pending: NANGO_PENDING },
  { type: "notion", name: "Notion", icon: "file", desc: "Wikis, handbooks, docs", pending: NANGO_PENDING },
  { type: "webapp", name: "Internal web app", icon: "globe", desc: "Agent browses & learns the tool" },
  { type: "files", name: "Upload docs", icon: "upload", desc: "PDFs, decks, local tools' docs" },
];
