"use client";

import { useAction, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorText, StatusSlot, useConnector, useToast } from "./shared";

// Slack / Jira / Notion / Drive (P1) through Nango Cloud: Connect asks Convex for a short-lived
// connect session, opens Nango's Connect UI, and on success hands the connection id back to be
// verified and stored. A tool whose Nango integration isn't configured keeps the mockup's button,
// disabled, with the reason as its tooltip — never a simulated connection.

type NangoType = "slack" | "jira" | "notion" | "drive";
type Status = { configured: boolean; integrations: Partial<Record<string, string>> };

/** One Nango account lookup per page, shared by every Nango card. */
let statusPromise: Promise<Status> | null = null;

const LABELS: Record<NangoType, string> = { slack: "Slack", jira: "Jira", notion: "Notion", drive: "Google Drive" };

function NangoConnect({ spaceId, type }: { spaceId: Id<"spaces">; type: NangoType }) {
  const connector = useConnector(spaceId, type);
  const nangoStatus = useAction(api.connectorAuth.nangoStatus);
  const session = useAction(api.connectorAuth.nangoSession);
  const connected = useAction(api.connectorAuth.nangoConnected);
  const cancel = useMutation(api.connectors.cancelAuth);
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    statusPromise ??= nangoStatus({ spaceId }).catch(() => ({ configured: false, integrations: {} }));
    let live = true;
    void statusPromise.then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [nangoStatus, spaceId]);

  const ready = Boolean(status?.integrations[type]);
  const reason = !status ? "Checking Nango…" : !status.configured ? "Needs Nango setup (NANGO_SECRET_KEY)" : !ready ? `Needs Nango integration setup for ${LABELS[type]}` : (connector?.error ?? undefined);

  async function open() {
    setBusy(true);
    try {
      const { token } = await session({ spaceId, type });
      const { default: Nango } = await import("@nangohq/frontend");
      let done = false;
      new Nango().openConnectUI({
        sessionToken: token,
        onEvent: async (event) => {
          if (event.type === "connect") {
            done = true;
            try {
              await connected({ spaceId, type, connectionId: event.payload.connectionId, providerConfigKey: event.payload.providerConfigKey });
              toast(`Agent is reading ${LABELS[type]} — brain updated`);
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
    <StatusSlot
      connector={connector}
      button={
        <button className="btn btn-dark" disabled={!ready || busy} title={reason} onClick={() => void open()}>
          Connect
        </button>
      }
    />
  );
}

export const SlackConnect = ({ spaceId }: { spaceId: Id<"spaces"> }) => <NangoConnect spaceId={spaceId} type="slack" />;
export const JiraConnect = ({ spaceId }: { spaceId: Id<"spaces"> }) => <NangoConnect spaceId={spaceId} type="jira" />;
export const NotionConnect = ({ spaceId }: { spaceId: Id<"spaces"> }) => <NangoConnect spaceId={spaceId} type="notion" />;
export const DriveConnect = ({ spaceId }: { spaceId: Id<"spaces"> }) => <NangoConnect spaceId={spaceId} type="drive" />;
