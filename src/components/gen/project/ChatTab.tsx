"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo, useState } from "react";
import { useVersions } from "./useVersions";

export function ChatTab({ flowId, bump, onChanged }: { flowId: string; bump: unknown; onChanged: () => void }) {
  const { data, reload } = useVersions(flowId, bump);
  const transport = useMemo(() => new DefaultChatTransport({ api: `/api/gen/flows/${flowId}/chat` }), [flowId]);
  const { messages, sendMessage, status, error } = useChat({
    transport,
    onFinish: async () => {
      await reload();
      onChanged();
    },
  });
  const [input, setInput] = useState("");
  const latest = data?.versions[0];
  const previous = data?.versions[1];
  const history = data?.chat ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="chat-tab">
      <div className="g-panel flex min-h-[420px] flex-col">
        <ol className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
          {history.length === 0 && messages.length === 0 && <li className="g-muted">Ask for a change, for example &quot;make the welcome step shorter and use a fade transition&quot;.</li>}
          {messages.length === 0 &&
            history.map((m, i) => (
              <li key={`h${i}`} className={m.role === "user" ? "text-right" : ""}>
                <span className="inline-block max-w-[85%] rounded-lg px-3 py-2" style={{ background: m.role === "user" ? "var(--g-ink)" : "var(--g-canvas)", color: m.role === "user" ? "#fff" : undefined }}>
                  {m.content}
                </span>
              </li>
            ))}
          {messages.map((m) => (
            <li key={m.id} className={m.role === "user" ? "text-right" : ""} data-testid={`chat-${m.role}`}>
              {m.parts.map((p, i) =>
                p.type === "text" ? (
                  <span key={i} className="inline-block max-w-[85%] rounded-lg px-3 py-2 text-left whitespace-pre-wrap" style={{ background: m.role === "user" ? "var(--g-ink)" : "var(--g-canvas)", color: m.role === "user" ? "#fff" : undefined }}>
                    {p.text}
                  </span>
                ) : p.type.startsWith("tool-") ? (
                  <span key={i} className="g-muted block text-xs">
                    {p.type.slice(5).replace(/_/g, " ")}
                    {"state" in p && p.state === "output-available" ? " applied" : " running"}
                  </span>
                ) : null,
              )}
            </li>
          ))}
        </ol>
        {error && <p className="px-4 text-sm" style={{ color: "var(--g-danger)" }}>{error.message}</p>}
        <form
          className="flex gap-2 border-t p-3"
          style={{ borderColor: "var(--g-line)" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim()) return;
            void sendMessage({ text: input });
            setInput("");
          }}
        >
          <input className="g-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe a change" disabled={status !== "ready"} data-testid="chat-input" aria-label="Describe a change" />
          <button className="g-btn" type="submit" disabled={status !== "ready" || !input.trim()} data-testid="chat-send">
            {status === "ready" ? "Send" : "Working"}
          </button>
        </form>
      </div>
      <aside className="g-panel space-y-3 p-4 text-sm">
        <h3 className="font-semibold">Latest change</h3>
        {latest ? (
          <>
            <p data-testid="latest-version">
              Version {latest.version}: {latest.diff?.summary ?? "generated"}
            </p>
            {latest.diff?.patch && <pre className="max-h-64 overflow-auto rounded p-2 text-xs" style={{ background: "var(--g-canvas)" }}>{latest.diff.patch.split("\n").slice(4).join("\n")}</pre>}
            {previous && latest.created_by_action !== "generate" && (
              <button
                className="g-btn g-btn-quiet text-sm"
                onClick={async () => {
                  await fetch(`/api/gen/flows/${previous.id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "undo" }) });
                  await reload();
                  onChanged();
                }}
                data-testid="undo-change"
              >
                Undo this change
              </button>
            )}
          </>
        ) : (
          <p className="g-muted">No changes yet.</p>
        )}
      </aside>
    </div>
  );
}
