"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

// Link + QR for a published onboarding world (D-33). The QR is rendered locally (no external
// service) so it works offline and on the stand-in.

/** The deploy URL is absolute for Vercel, app-relative (`/o/<slug>`) for the stand-in. */
export function absoluteUrl(url: string, origin: string): string {
  return /^https?:\/\//.test(url) ? url : new URL(url, origin).toString();
}

export function DeployQr({ url, size = 168 }: { url: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toString(url, { type: "svg", margin: 1, width: size }).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [url, size]);
  if (!svg) return null;
  return <span className="deploy-qr" role="img" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
