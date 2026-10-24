"use client";
import { useEffect, useState } from "react";

const LANG: Record<string, string> = { json: "json", css: "css", jsx: "jsx", tsx: "tsx", diff: "diff" };

/** Read-only code with shiki, loaded on demand so it stays out of the main bundle. */
export function CodeView({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("shiki").then(async ({ codeToHtml }) => {
      const out = await codeToHtml(code, { lang: LANG[lang] ?? "text", theme: "github-light" });
      if (live) setHtml(out);
    });
    return () => {
      live = false;
    };
  }, [code, lang]);
  if (!html) return <pre className="overflow-auto p-4 text-xs">{code}</pre>;
  return <div className="max-h-[560px] overflow-auto text-xs [&_pre]:p-4" dangerouslySetInnerHTML={{ __html: html }} data-testid="code-view" />;
}
