"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reveals `text` one character at a time, like a game text box. `skip()` shows the rest at once.
 * `onTick` runs per revealed character (for text blips). With `instant`, the whole text shows immediately.
 */
export function useTypewriter(text: string, { cps = 45, instant = false, onTick }: { cps?: number; instant?: boolean; onTick?: (char: string) => void } = {}) {
  const [progress, setProgress] = useState({ text, count: instant ? text.length : 0 });
  const count = instant ? text.length : progress.text === text ? progress.count : 0;
  const done = count >= text.length;
  const tick = useRef(onTick);
  useEffect(() => {
    tick.current = onTick;
  }, [onTick]);

  useEffect(() => {
    if (instant || done) return;
    let shown = count;
    const id = setInterval(() => {
      shown = Math.min(text.length, shown + 1);
      const char = text[shown - 1];
      if (char && char.trim()) tick.current?.(char);
      setProgress({ text, count: shown });
      if (shown >= text.length) clearInterval(id);
    }, 1000 / cps);
    return () => clearInterval(id);
    // `count` is read once at start; the interval tracks its own progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, instant, done, cps]);

  const skip = useCallback(() => setProgress({ text, count: text.length }), [text]);
  return { shown: text.slice(0, count), done, skip };
}
