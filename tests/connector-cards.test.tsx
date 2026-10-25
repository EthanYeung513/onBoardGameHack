// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Connector cards are the buttons (Nicole): every card opens its page, also once connected, and
// Upload docs never shows a connected label and always opens the upload flow.

const now = Date.now();
const connectors = [
  { _id: "c1", type: "github", status: "ready", label: "acme", lastSyncedAt: now, error: null, pendingChanges: 0, connected: true, pendingFiles: 0 },
  { _id: "c2", type: "files", status: "ready", label: "Uploaded docs", lastSyncedAt: now, error: null, pendingChanges: 0, connected: true, pendingFiles: 0 },
];
const uploads = { pending: [{ name: "glossary.md", size: 10 }], read: [{ _id: "s1", name: "handbook.md", size: 2048, readAt: now }] };
const nangoStatus = vi.fn(async () => ({ configured: false, integrations: {} }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    if (name === "dashboard:tools") return { facts: 3, connectors };
    if (name === "connectors:list") return { facts: 3, connectors };
    if (name === "connectors:uploads") return uploads;
    return undefined;
  },
  useMutation: () => vi.fn(),
  useAction: (ref: never) => (getFunctionName(ref) === "connectorAuth:nangoStatus" ? nangoStatus : vi.fn()),
}));

const { ToolsTab } = await import("@/components/manager/dashboard/ToolsTab");
const space = { _id: "space1" } as never;

function renderTab() {
  render(<ToolsTab space={space} toast={vi.fn()} />);
  return userEvent.setup();
}

describe("Tools tab connector cards", () => {
  beforeEach(() => nangoStatus.mockClear());

  it("has no Connect buttons on the cards; each card is a keyboard-focusable button", () => {
    renderTab();
    const grid = document.getElementById("tool-cards")!;
    expect(within(grid).queryByText("Connect")).toBeNull();
    for (const name of ["GitHub", "Slack", "Jira", "Notion", "Internal web app", "Upload docs"]) {
      expect(within(grid).getByRole("button", { name })).toHaveAttribute("tabindex", "0");
    }
  });

  it("a connected card keeps its label and still opens its page to update the connection", async () => {
    const user = renderTab();
    const card = screen.getByRole("button", { name: "GitHub" });
    expect(within(card).getByText("Connected ✓")).toBeInTheDocument();
    await user.click(card);
    const dialog = screen.getByRole("dialog", { name: "GitHub" });
    expect(within(dialog).getByRole("heading", { name: "Update GitHub" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Personal access token")).toBeInTheDocument();
  });

  it("Upload docs shows no connected label and opens the upload flow when docs are already uploaded", async () => {
    const user = renderTab();
    const card = screen.getByRole("button", { name: "Upload docs" });
    expect(within(card).queryByText(/Connected/)).toBeNull();
    card.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Upload docs" });
    expect(within(dialog).getByText("Choose files or drop them here")).toBeInTheDocument();
    expect(within(dialog).getByTestId("files-input")).toHaveAttribute("multiple");
    const list = within(dialog).getByRole("list", { name: "Uploaded docs" });
    expect(within(list).getByText("handbook.md")).toBeInTheDocument();
    expect(within(list).getByText("glossary.md")).toBeInTheDocument();
  });

  it("an unconfigured Nango tool still opens its page and says it isn't set up, without faking success", async () => {
    const user = renderTab();
    await user.click(screen.getByRole("button", { name: "Slack" }));
    const dialog = screen.getByRole("dialog", { name: "Slack" });
    await waitFor(() => expect(within(dialog).getByText(/not set up on this server/)).toBeInTheDocument());
    expect(within(dialog).getByRole("button", { name: "Connect Slack" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
