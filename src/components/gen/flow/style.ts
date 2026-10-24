import type { Transition as MotionTransition, Variants } from "motion/react";
import type { Transition } from "@/lib/flow/spec";

type Role = "primary" | "accent" | "text" | "muted" | "secondary";

/** A token colour mixed into the surface colour. */
export function tint(role: Role, pct: number, base = "var(--ob-surface)"): string {
  return `color-mix(in srgb, var(--ob-${role}) ${pct}%, ${base})`;
}

export const ease: MotionTransition["ease"] = [0.22, 1, 0.36, 1];

const springy: MotionTransition = { type: "spring", stiffness: 420, damping: 36, mass: 0.9 };

/** Step container variants. `custom` is the navigation direction (+1 forward, -1 back). */
export const stepVariants: Record<Transition, Variants> = {
  slide: {
    enter: (dir: number) => ({ x: 48 * dir, opacity: 0 }),
    center: { x: 0, opacity: 1, transition: springy },
    exit: (dir: number) => ({ x: -48 * dir, opacity: 0, transition: { duration: 0.2, ease } }),
  },
  fade: {
    enter: { opacity: 0 },
    center: { opacity: 1, transition: { duration: 0.35, ease } },
    exit: { opacity: 0, transition: { duration: 0.18 } },
  },
  scale: {
    enter: { opacity: 0, scale: 0.92 },
    center: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 380, damping: 26 } },
    exit: { opacity: 0, scale: 1.04, transition: { duration: 0.18, ease } },
  },
  stagger: {
    enter: { opacity: 0 },
    center: { opacity: 1, transition: { duration: 0.2, staggerChildren: 0.07, delayChildren: 0.04 } },
    exit: { opacity: 0, transition: { duration: 0.16 } },
  },
  morph: {
    enter: { opacity: 0 },
    center: { opacity: 1, transition: { duration: 0.3, ease, delay: 0.05 } },
    exit: { opacity: 0, transition: { duration: 0.15 } },
  },
};

/** Child variants used inside a step. Only the stagger transition moves children on their own. */
export const staggerItem: Variants = {
  enter: { opacity: 0, y: 14 },
  center: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 420, damping: 32 } },
  exit: { opacity: 0 },
};

export const morphLayout: MotionTransition = { type: "spring", stiffness: 320, damping: 32 };
