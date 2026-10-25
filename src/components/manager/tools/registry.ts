import type { ComponentType } from "react";
import { FilesPanel, WebappPanel } from "./FilesPanel";
import { GithubPanel } from "./GithubPanel";
import { JiraPanel, NotionPanel, SlackPanel } from "./NangoPanel";
import type { PanelProps } from "./shared";

// The Tools tab's cards (mockup `OB.TOOLS`, same order, names, icons and copy). Each card is
// itself the button: it opens the tool's page (`panel`) to connect or update the connection at
// any time. Upload docs carries no connected label; its page always lets you upload more.

export type ToolType = "github" | "slack" | "jira" | "notion" | "webapp" | "files";

export type ToolEntry = {
  type: ToolType;
  name: string;
  icon: string;
  desc: string;
  /** The page the card opens (PAT form, Nango connect, upload…). */
  panel: ComponentType<PanelProps>;
  /** Show the connection status pill on the card (everything except Upload docs). */
  status: boolean;
};

export const TOOLS: ToolEntry[] = [
  { type: "github", name: "GitHub", icon: "code", desc: "Repos, PRs, code review norms", panel: GithubPanel, status: true },
  { type: "slack", name: "Slack", icon: "hash", desc: "Channels, jargon, rituals", panel: SlackPanel, status: true },
  { type: "jira", name: "Jira", icon: "kanban", desc: "Boards, sprint cadence", panel: JiraPanel, status: true },
  { type: "notion", name: "Notion", icon: "file", desc: "Wikis, handbooks, docs", panel: NotionPanel, status: true },
  { type: "webapp", name: "Internal web app", icon: "globe", desc: "Agent browses & learns the tool", panel: WebappPanel, status: true },
  { type: "files", name: "Upload docs", icon: "upload", desc: "PDFs, decks, local tools' docs", panel: FilesPanel, status: false },
];
