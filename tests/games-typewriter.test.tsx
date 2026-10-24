// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTypewriter } from "@/games/core/useTypewriter";

describe("useTypewriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reveals text over time, ticks per visible character, and can skip", () => {
    const onTick = vi.fn();
    const { result, rerender } = renderHook(({ text }) => useTypewriter(text, { cps: 10, onTick }), { initialProps: { text: "Hi you" } });
    expect(result.current.shown).toBe("");
    act(() => vi.advanceTimersByTime(250));
    expect(result.current.shown).toBe("Hi");
    act(() => result.current.skip());
    expect(result.current).toMatchObject({ shown: "Hi you", done: true });
    expect(onTick).toHaveBeenCalledTimes(2);

    rerender({ text: "Next" });
    expect(result.current.shown).toBe("");
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toMatchObject({ shown: "Next", done: true });
  });

  it("shows everything at once when instant", () => {
    const { result } = renderHook(() => useTypewriter("All at once", { instant: true }));
    expect(result.current).toMatchObject({ shown: "All at once", done: true });
  });
});
