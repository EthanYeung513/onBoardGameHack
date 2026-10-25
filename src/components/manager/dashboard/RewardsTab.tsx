"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Icon } from "@/components/manager/icons";
import { FormModal, type FormField } from "./FormModal";
import { errMsg, type TabProps } from "./shared";

type Reward = { _id: Id<"rewards">; name: string; costCoins: number };
type Dialog =
  | { kind: "add" }
  | { kind: "edit"; reward: Reward }
  | { kind: "send"; reward: Reward }
  | { kind: "remove"; reward: Reward };

/** The mockup's reward icons, picked from the reward's name (rewards have no icon field). */
export function rewardIcon(name: string): string {
  const n = name.toLowerCase();
  if (/\b(coffee|tea)\b/.test(n)) return "coffee";
  if (/\b(lunch|dinner|meal|food|snacks?)\b/.test(n)) return "utensils";
  if (/\b(hoodie|t?-?shirt|tee|swag|merch)\b/.test(n)) return "shirt";
  if (/\b(day|friday|leave|off)\b/.test(n)) return "sun";
  return "gift";
}

const small = { marginLeft: 0, padding: "8px 12px" } as const;

export function RewardsTab({ space, toast }: TabProps) {
  const data = useQuery(api.rewards.list, { spaceId: space._id });
  const create = useMutation(api.rewards.create);
  const update = useMutation(api.rewards.update);
  const remove = useMutation(api.rewards.remove);
  const send = useMutation(api.rewards.send);

  const [dialog, setDialog] = useState<Dialog | null>(null);

  /** Runs a mutation from the modal: a toast on success, the error shown in the modal otherwise. */
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      return null;
    } catch (err) {
      return errMsg(err);
    }
  };

  const rewardFields = (r?: Reward): FormField[] => [
    { name: "name", label: "Reward name", placeholder: "e.g. Coffee voucher ($5)", initial: r?.name, required: true },
    { name: "cost", label: "Cost in coins", type: "number", placeholder: "120", initial: r ? String(r.costCoins) : "", required: true, min: 1 },
  ];

  const modal = (() => {
    if (!dialog) return null;
    const close = () => setDialog(null);
    switch (dialog.kind) {
      case "add":
        return (
          <FormModal title="Add reward" sub="Hires buy it with coins in the in-game shop." fields={rewardFields()} submitLabel="Add to shop" onClose={close}
            onSubmit={(v) => run(() => create({ spaceId: space._id, name: v.name, costCoins: Number(v.cost) }), `${v.name} added to the shop`)} />
        );
      case "edit":
        return (
          <FormModal title="Edit reward" fields={rewardFields(dialog.reward)} submitLabel="Save" onClose={close}
            onSubmit={(v) => run(() => update({ rewardId: dialog.reward._id, name: v.name, costCoins: Number(v.cost) }), "Reward updated")} />
        );
      case "send":
        return (
          <FormModal title={`Send “${dialog.reward.name}”`} sub="Gift it to a hire directly." submitLabel="Send" onClose={close}
            fields={[{ name: "email", label: "Hire's work email", type: "email", placeholder: "name@company.com", required: true }]}
            onSubmit={(v) => run(() => send({ rewardId: dialog.reward._id, email: v.email }), `${dialog.reward.name} sent to ${v.email}`)} />
        );
      case "remove":
        return (
          <FormModal title={`Remove “${dialog.reward.name}”?`} sub="It disappears from the shop; past redemptions keep their history." fields={[]} submitLabel="Remove" danger onClose={close}
            onSubmit={() => run(() => remove({ rewardId: dialog.reward._id }), "Reward removed")} />
        );
    }
  })();

  return (
    <>
      {modal}
      <div className="top">
        <div>
          <h1>Rewards</h1>
          <p>Send perks to hires.</p>
        </div>
      </div>
      <div className="panel">
        <div className="ptitle">
          <h3 style={{ marginBottom: 0 }}>Shop catalog</h3>
          <button className="btn btn-ghost" onClick={() => setDialog({ kind: "add" })}>
            + Add reward
          </button>
        </div>
        <div className="shop-grid" id="reward-list">
          {data && data.rewards.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>No rewards yet.</p>
          )}
          {data?.rewards.map((r) => (
            <div className="reward" key={r._id}>
              <span className="e">
                <Icon name={rewardIcon(r.name)} size={26} />
              </span>
              <div>
                <b>{r.name}</b>
                <span>{r.costCoins} coins · via in-game shop</span>
              </div>
              <button className="btn btn-dark" onClick={() => setDialog({ kind: "send", reward: r })}>
                Send to a hire
              </button>
              <button className="btn btn-ghost" style={small} onClick={() => setDialog({ kind: "edit", reward: r })}>
                Edit
              </button>
              <button
                className="btn btn-ghost"
                style={small}
                onClick={() => setDialog({ kind: "remove", reward: r })}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Recent redemptions</h3>
        <div id="redemptions" style={{ fontSize: 13, color: "var(--muted)" }}>
          {!data?.redemptions.length
            ? "None yet."
            : data.redemptions.map((r) => (
                <div className="fact" key={r._id}>
                  <span className="cat">
                    <Icon name="gift" size={13} />
                  </span>
                  <span>
                    {r.hireName} redeemed {r.rewardName}
                    {r.status === "declined" ? " (declined)" : r.status === "requested" ? " (awaiting approval)" : ""}
                  </span>
                </div>
              ))}
        </div>
      </div>
    </>
  );
}
