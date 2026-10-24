"use client";
import { useCallback, useEffect, useState } from "react";

export interface VersionRow {
  id: string;
  version: number;
  status: string;
  created_by_action: string;
  created_at: string;
  diff: { patch: string; summary: string } | null;
  parent_id: string | null;
}
export interface FileRow {
  flow_id: string;
  path: string;
  content: string;
  version: number;
}
export interface ChatRow {
  role: string;
  content: string;
  tool_calls: Array<{ tool: string; summary: string; version?: number; errors?: string[] }> | null;
  created_at: string;
}

export function useVersions(flowId: string, bump: unknown) {
  const [data, setData] = useState<{ versions: VersionRow[]; files: FileRow[]; chat: ChatRow[] } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/gen/flows/${flowId}/versions`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [flowId]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/gen/flows/${flowId}/versions`, { cache: "no-store" }).then(async (r) => {
      if (active && r.ok) setData(await r.json());
    });
    return () => {
      active = false;
    };
  }, [flowId, bump]);
  return { data, reload: load };
}
