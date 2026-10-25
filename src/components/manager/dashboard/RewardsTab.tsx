"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Icon } from "@/components/manager/icons";
import { errMsg, type TabProps } from "./shared";

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

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (err) {
      toast(errMsg(err));
    }
  };

  const askCost = (initial?: number) => {
    const raw = window.prompt("Cost in coins:", initial ? String(initial) : "");
    return raw === null ? null : Number(raw.trim());
  };

  const add = async () => {
    const name = window.prompt("New reward — name (e.g. Coffee voucher — $5):");
    if (!name) return;
    const costCoins = askCost();
    if (costCoins === null) return;
    await run(() => create({ spaceId: space._id, name, costCoins }), `${name} added to the shop`);
  };

  const edit = async (r: { _id: Id<"rewards">; name: string; costCoins: number }) => {
    const name = window.prompt("Reward name:", r.name);
    if (name === null) return;
    const costCoins = askCost(r.costCoins);
    if (costCoins === null) return;
    await run(() => update({ rewardId: r._id, name, costCoins }), "Reward updated");
  };

  const gift = async (r: { _id: Id<"rewards">; name: string }) => {
    const email = window.prompt(`Send "${r.name}" to which hire? (email)`);
    if (!email) return;
    await run(() => send({ rewardId: r._id, email }), `${r.name} sent to ${email}`);
  };

  return (
    <>
      <div className="top">
        <div>
          <h1>Rewards</h1>
          <p>Send perks to hires — funded by your rewards budget.</p>
        </div>
      </div>
      <div className="panel">
        <div className="ptitle">
          <h3 style={{ marginBottom: 0 }}>Shop catalog</h3>
          <button className="btn btn-ghost" onClick={() => void add()}>
            + Add reward
          </button>
        </div>
        <div className="shop-grid" id="reward-list">
          {data && data.rewards.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>No rewards yet — add perks hires can buy in the in-game shop.</p>
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
              <button className="btn btn-dark" onClick={() => void gift(r)}>
                Send to a hire
              </button>
              <button className="btn btn-ghost" style={small} onClick={() => void edit(r)}>
                Edit
              </button>
              <button
                className="btn btn-ghost"
                style={small}
                onClick={() => window.confirm(`Remove "${r.name}" from the shop?`) && void run(() => remove({ rewardId: r._id }), "Reward removed")}
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
            ? "None yet — rewards hires redeem in the game will appear here."
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
