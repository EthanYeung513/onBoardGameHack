import type { Metadata } from "next";
import { FlowPreviewGallery } from "@/components/gen/flow/FlowPreviewGallery";

export const metadata: Metadata = { title: "Flow preview" };

// Dev preview of the sample flows. Query params: ?variant=quest|streak|quiz&step=<index>&theme=default|night&motion=off
export default async function FlowPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const step = Number(one(sp.step));
  return (
    <FlowPreviewGallery
      initialVariant={one(sp.variant) ?? "all"}
      initialStep={Number.isFinite(step) ? step : undefined}
      initialTheme={one(sp.theme) === "night" ? "night" : "default"}
      reducedMotion={one(sp.motion) === "off" ? true : undefined}
    />
  );
}
