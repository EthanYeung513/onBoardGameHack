// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Product decisions (Nicole 2026-10-25): Google sign-in is real, Apple is out of scope, and the
// "Only if your company's IT team…" note is gone.

const signIn = vi.fn().mockResolvedValue(undefined);
let providers: { password: boolean; magicLink: boolean; google: boolean } | undefined;

vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: false }),
  useConvex: () => ({ query: vi.fn() }),
  useMutation: () => vi.fn(),
  useQuery: (_fn: unknown, args: unknown) => (args === "skip" ? undefined : providers),
}));

const { LoginCard } = await import("@/app/(auth)/login/LoginCard");

describe("login page", () => {
  beforeEach(() => signIn.mockClear());

  it("runs the Convex Auth Google flow from both Google buttons when Google is configured", () => {
    providers = { password: true, magicLink: false, google: true };
    render(<LoginCard next="/dashboard" />);
    fireEvent.click(screen.getByRole("button", { name: /Login with Google/ }));
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("has no Apple sign-in or IT-team note, and says so honestly when Google isn't configured", () => {
    providers = { password: true, magicLink: false, google: false };
    render(<LoginCard />);
    expect(screen.queryByText(/Only if your company/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    expect(screen.queryByText(/Apple/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByText(/Google sign-in isn.t set up yet/)).toBeTruthy();
  });
});
