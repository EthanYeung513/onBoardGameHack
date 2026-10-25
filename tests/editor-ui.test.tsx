// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { BrandOptions } from "@/components/editor/contracts";
import { Editor, type EditorData } from "@/components/editor/Editor";

const calls = vi.hoisted(() => ({ mutations: {} as Record<string, ReturnType<typeof vi.fn>> }));

vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    calls.mutations[name] ??= vi.fn(async () => null);
    return calls.mutations[name];
  },
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const spaceId = "space1" as Id<"spaces">;
const courseId = "course1" as Id<"courses">;

function data(over: Partial<NonNullable<EditorData["course"]>> = {}): EditorData {
  return {
    space: { _id: spaceId, name: "Acme Pay", host: "acmepay.example", status: "ready", mode: "offline" },
    brand: null,
    courses: [{ _id: courseId, title: "Tools & Stack", needsRefresh: false }],
    course: {
      _id: courseId,
      title: "Tools & Stack",
      building: "Workshop",
      game: "road",
      version: 4,
      needsRefresh: false,
      spec: {
        steps: [
          { id: "welcome", kind: "welcome", title: "Welcome to Acme Pay", body: "Start here.", teaches_fact_ids: [] },
          { id: "deploys", kind: "quiz", title: "When do we deploy?", options: [{ label: "Tuesdays", correct: true }, { label: "Fridays" }], teaches_fact_ids: ["f1"] },
          { id: "done", kind: "done", title: "You're all set.", teaches_fact_ids: [] },
        ],
      },
      staleSteps: {},
      ...over,
    },
    generating: null,
  };
}

const options: BrandOptions = {
  requestId: "req-1",
  fields: {
    primary: {
      candidates: [
        { value: "#111111", evidence: "footer" },
        { value: "#0a2540", evidence: "header buttons" },
      ],
      recommended: "#0a2540",
      reason: "Used on every primary button",
      source: "mubit",
    },
  },
};

const mut = (name: string) => calls.mutations[name];

beforeEach(() => {
  calls.mutations = {};
  push.mockReset();
});

describe("Editor", () => {
  it("commits a click-to-edit title as a versioned set patch", async () => {
    render(<Editor spaceId={spaceId} data={data()} assets={undefined} options={null} />);
    const title = screen.getByRole("textbox", { name: "Step title" });
    title.textContent = "Welcome aboard";
    fireEvent.blur(title);
    await waitFor(() =>
      expect(mut("courses:applyPatch")).toHaveBeenCalledWith({
        courseId,
        version: 4,
        patches: [{ op: "set", path: "/steps/0/title", value: "Welcome aboard" }],
      }),
    );
  });

  it("surfaces a 409 as a toast and reverts the text", async () => {
    render(<Editor spaceId={spaceId} data={data()} assets={undefined} options={null} />);
    mut("courses:applyPatch").mockRejectedValueOnce(new ConvexError({ code: 409, message: "Course changed" }));
    const title = screen.getByRole("textbox", { name: "Step title" });
    title.textContent = "Stale edit";
    fireEvent.blur(title);
    expect(await screen.findByText(/Someone else changed this course/)).toBeInTheDocument();
    await waitFor(() => expect(title.textContent).toBe("Welcome to Acme Pay"));
  });

  it("marks stale steps with the changed source and refreshes on request", async () => {
    const d = data({ staleSteps: { deploys: [{ type: "slack", title: "#eng-announcements" }] } });
    render(<Editor spaceId={spaceId} data={d} assets={undefined} options={null} />);
    const marker = screen.getByTestId("stale-deploys");
    expect(marker).toHaveTextContent("Needs refresh");
    expect(marker).toHaveTextContent("Slack: #eng-announcements");
    await userEvent.click(within(marker).getByRole("button", { name: "Refresh step" }));
    expect(mut("courses:regenerateSteps")).toHaveBeenCalledWith({ courseId, stepIds: ["deploys"] });
  });

  it("Design tab leads with the recommended option and records picks via brand.decide", async () => {
    render(<Editor spaceId={spaceId} data={data()} assets={undefined} options={options} />);
    await userEvent.click(screen.getByRole("button", { name: "Design" }));
    const recs = within(screen.getByTestId("recs-primary")).getAllByRole("button");
    expect(recs.map((b) => b.getAttribute("aria-label"))).toEqual(["#0a2540 (recommended)", "#111111"]);
    expect(recs[0]).toHaveTextContent(/Recommended.*via Mubit/);
    expect(recs[0]).toHaveAttribute("title", "Recommended by Mubit");

    await userEvent.click(recs[1]);
    expect(mut("brand:decide")).toHaveBeenCalledWith({ spaceId, field: "primary", chosen: "#111111", recommended: "#0a2540" });
    expect(screen.getByText("#111111", { selector: ".val" })).toBeInTheDocument();
  });

  it("Continue goes to the dashboard", async () => {
    render(<Editor spaceId={spaceId} data={data()} assets={undefined} options={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
    expect(push).toHaveBeenCalledWith(`/dashboard?space=${spaceId}`);
  });
});
