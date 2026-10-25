"use client";

import { useAction, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { ConnectionLine, errorText, Modal, useConnector, useToast, type PanelProps } from "./shared";

// Slack / Jira / Notion / Drive (P1) through Nango Cloud. The card opens this page at any time:
// connect, or reconnect to update the connection. Connecting asks Convex for a short-lived connect
// session, opens Nango's Connect UI, and on success hands the connection id back to be verified
// and stored. A tool whose Nango integration isn't configured says so here, with the connect
// button disabled: never a simulated connection.

export type NangoType = "slack" | "jira" | "notion" | "drive";
type Status = { configured: boolean; integrations: Partial<Record<string, string>> };

/** One Nango account lookup per page load, shared by every Nango card. */
let statusPromise: Promise<Status> | null = null;

const LABELS: Record<NangoType, string> = { slack: "Slack", jira: "Jira", notion: "Notion", drive: "Google Drive" };
const READS: Record<NangoType, string> = {
  slack: "Agents read the public channels the app is invited to: jargon, rituals, who to ask.",
  jira: "Agents read boards, issue types and sprint cadence.",
  notion: "Agents read the pages and wikis you share with the integration.",
  drive: "Agents read the docs, decks and PDFs you share.",
};

export function NangoPanel({ spaceId, open, onClose, type }: PanelProps & { type: NangoType }) {
  const connector = useConnector(spaceId, type);
  const nangoStatus = useAction(api.connectorAuth.nangoStatus);
  const session = useAction(api.connectorAuth.nangoSession);
  const connected = useAction(api.connectorAuth.nangoConnected);
  const cancel = useMutation(api.connectors.cancelAuth);
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const label = LABELS[type];
  const update = Boolean(connector?.connected);

  useEffect(() => {
    if (!open) return;
    statusPromise ??= nangoStatus({ spaceId }).catch(() => ({ configured: false, integrations: {} }));
    let live = true;
    void statusPromise.then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [open, nangoStatus, spaceId]);

  const ready = Boolean(status?.integrations[type]);

  async function start() {
    setBusy(true);
    try {
      const { token } = await session({ spaceId, type });
      const { default: Nango } = await import("@nangohq/frontend");
      onClose(); // Nango's Connect UI is its own overlay
      let done = false;
      new Nango().openConnectUI({
        sessionToken: token,
        onEvent: async (event) => {
          if (event.type === "connect") {
            done = true;
            try {
              await connected({ spaceId, type, connectionId: event.payload.connectionId, providerConfigKey: event.payload.providerConfigKey });
              toast(`Agent is reading ${label}`);
            } catch (err) {
              toast(errorText(err));
            }
          } else if (event.type === "close" && !done) {
            await cancel({ spaceId, type });
          }
        },
      });
    } catch (err) {
      toast(errorText(err));
      await cancel({ spaceId, type }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} label={label}>
      <h3>{update ? `Update ${label}` : `Connect ${label}`}</h3>
      <ConnectionLine spaceId={spaceId} type={type} />
      <p className="sub">{READS[type]}</p>
      {!status ? (
        <p className="panel-note">Checking the {label} integration…</p>
      ) : !status.configured ? (
        <p className="panel-note">
          {label} is not set up on this server yet. An admin needs to add a Nango secret key (NANGO_SECRET_KEY) before anyone can connect it.
        </p>
      ) : !ready ? (
        <p className="panel-note">The Nango account has no {label} integration yet. Add one in Nango, then come back here to connect.</p>
      ) : null}
      <button className="btn btn-dark btn-block" disabled={!ready || busy} onClick={() => void start()}>
        {busy ? "Opening…" : update ? `Reconnect ${label}` : `Connect ${label}`}
      </button>
    </Modal>
  );
}

const nango = (type: NangoType) =>
  function NangoTool(props: PanelProps) {
    return <NangoPanel {...props} type={type} />;
  };

export const SlackPanel = nango("slack");
export const JiraPanel = nango("jira");
export const NotionPanel = nango("notion");
export const DrivePanel = nango("drive");
