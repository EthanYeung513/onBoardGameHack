// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Constructor } from "@/components/orthogonal/Constructor";
import { scanSite } from "@/services/orthogonal";

afterEach(() => vi.unstubAllGlobals());

describe("Constructor", () => {
  it("scans the typed site, plays the scan and asks about GitHub", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => Response.json(await scanSite(JSON.parse(String(init?.body)).url)));
    vi.stubGlobal("fetch", fetchMock);
    window.scrollTo = vi.fn();
    render(<Constructor pace="fast" />);

    await userEvent.type(screen.getByLabelText("Start with your website"), "acme.io");
    await userEvent.click(screen.getByRole("button", { name: "Scan my site →" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/orthogonal/scans", expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "acme.io" }) }));
    expect(await screen.findByText("Resolving acme.io")).toBeInTheDocument();
    expect(await screen.findByText("Connect a GitHub repo?", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("acme/web")).toBeInTheDocument();
  });

  it("returns to the hero with the error when the scan fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Site unreachable" }, { status: 502 })));
    window.scrollTo = vi.fn();
    render(<Constructor pace="fast" />);
    await userEvent.click(screen.getByRole("button", { name: "Scan my site →" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Site unreachable");
  });
});
