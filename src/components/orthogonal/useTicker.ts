import { useEffect, useRef, useState } from "react";

/**
 * Counts from 0 to `total`, one tick every `interval` ms, then calls `onComplete` `tail` ms after the last tick.
 * Pass `total = null` to wait (e.g. while a request is in flight). Timers are cleared on unmount.
 */
export function useTicker(total: number | null, interval: number, tail: number, onComplete: () => void): number {
  const [n, setN] = useState(0);
  const complete = useRef(onComplete);
  useEffect(() => {
    complete.current = onComplete;
  });
  useEffect(() => {
    if (total === null) return;
    const timers = Array.from({ length: total }, (_, i) => setTimeout(() => setN(i + 1), interval * (i + 1)));
    timers.push(setTimeout(() => complete.current(), interval * total + tail));
    return () => timers.forEach(clearTimeout);
  }, [total, interval, tail]);
  return n;
}
