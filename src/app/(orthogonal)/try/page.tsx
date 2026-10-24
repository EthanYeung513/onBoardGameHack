import type { Metadata } from "next";
import { Constructor } from "@/components/orthogonal/Constructor";

export const metadata: Metadata = {
  title: "Orthogonal · Onboarding from your website",
  description: "A smart constructor that reads your website and builds a multi-step onboarding around it. Edit it. Ship it to GitHub.",
};

export default function OrthogonalHome() {
  return <Constructor />;
}
