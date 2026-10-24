"use client";
import { Sandpack } from "@codesandbox/sandpack-react";
import { useMemo, useState } from "react";
import { CodeView } from "./CodeView";
import { useVersions } from "./useVersions";

export function FilesTab({ flowId, bump, onChanged }: { flowId: string; bump: unknown; onChanged: () => void }) {
  const { data, reload } = useVersions(flowId, bump);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [path, setPath] = useState("OnboardingFlow.jsx");
  const [view, setView] = useState<"code" | "preview" | "diff">("code");
  const [busy, setBusy] = useState(false);
  const versions = data?.versions ?? [];
  const selected = versions.find((v) => v.id === versionId) ?? versions[0];
  const files = useMemo(() => (data?.files ?? []).filter((f) => f.flow_id === selected?.id).sort((a, b) => a.path.localeCompare(b.path)), [data, selected]);
  const file = files.find((f) => f.path === path) ?? files[0];
  const component = files.find((f) => f.path.endsWith(".jsx"));
  if (!data) return <p className="g-muted">Loading files.</p>;
  if (!selected) return <p className="g-muted">No versions yet.</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]" data-testid="files-tab">
      <aside className="space-y-4">
        <div>
          <h3 className="mb-1 text-sm font-semibold">Versions</h3>
          <ul className="space-y-1 text-sm">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  className="w-full rounded-md px-2 py-1 text-left"
                  style={v.id === selected.id ? { background: "var(--g-ink)", color: "#fff" } : { background: "var(--g-surface)" }}
                  onClick={() => setVersionId(v.id)}
                  data-testid={`version-${v.version}`}
                >
                  v{v.version} <span className="opacity-70">{v.created_by_action}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold">Files</h3>
          <ul className="space-y-1 text-sm">
            {files.map((f) => (
              <li key={f.path}>
                <button className={`text-left hover:underline ${f.path === file?.path ? "font-semibold" : ""}`} onClick={() => setPath(f.path)} data-testid={`file-${f.path}`}>
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {selected.id !== versions[0].id && (
          <button
            className="g-btn w-full justify-center text-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await fetch(`/api/gen/flows/${selected.id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "rollback" }) });
              setBusy(false);
              setVersionId(null);
              await reload();
              onChanged();
            }}
            data-testid="restore-version"
          >
            Restore v{selected.version}
          </button>
        )}
      </aside>
      <div className="g-panel min-w-0 overflow-hidden">
        <div className="flex items-center gap-1 border-b p-2 text-sm" style={{ borderColor: "var(--g-line)" }}>
          {(["code", "preview", "diff"] as const).map((v) => (
            <button key={v} className="rounded px-2 py-1 capitalize" style={view === v ? { background: "var(--g-canvas)", fontWeight: 600 } : undefined} onClick={() => setView(v)} data-testid={`files-view-${v}`}>
              {v === "preview" ? "Live preview" : v === "diff" ? "Changes" : "Code"}
            </button>
          ))}
          <span className="g-muted ml-auto truncate">{selected.diff?.summary ?? "Generated version"}</span>
        </div>
        {view === "code" && file && <CodeView code={file.content} lang={file.path.split(".").pop() ?? "text"} />}
        {view === "diff" && (selected.diff?.patch ? <CodeView code={selected.diff.patch} lang="diff" /> : <p className="g-muted p-4">This is the first version, so there is nothing to compare.</p>)}
        {view === "preview" && component && (
          <Sandpack
            template="react"
            files={{ "/App.js": `import OnboardingFlow from "./OnboardingFlow";\nexport default function App() { return <OnboardingFlow />; }\n`, "/OnboardingFlow.jsx": component.content }}
            customSetup={{ dependencies: { motion: "^12.0.0" } }}
            options={{ showTabs: true, editorHeight: 560, showLineNumbers: true, readOnly: true }}
          />
        )}
      </div>
    </div>
  );
}
