# Payments engineering runbook

For engineers working on Acme Pay's payment systems. The Ledger is 11 years old and only three people have changed
it in the last year. Read this before touching anything in the payments path.

## Architecture

A payment flows through three services: the **gateway** (takes card payments from terminals), the **Ledger** (a
Java 8 monolith that records every balance movement) and the **payout service** (sends money to merchants' banks
each working day). The Ledger is the source of truth for balances. The gateway and payout service never write
balances themselves; they call the Ledger API.

## Ledger rules

- Never write directly to the Ledger database. All changes go through the Ledger API so they are audited.
- The nightly reconciliation job runs at 02:00 UK time. No Ledger deploys between 01:30 and 03:00.
- Every payout call must send an `Idempotency-Key` header. Without it, a retry can pay a merchant twice.
- Never re-run a payout batch by hand. Ask the payments on-call lead.

## Failed deploy runbook

1. Check #deploys and the Payments dashboard: error rate, payout queue depth, Ledger latency.
2. If errors rose after a Ledger deploy, roll back first: `deploy rollback ledger --to previous`. Don't hotfix forward
   on the Ledger.
3. If payouts have been stuck for more than 15 minutes, page the payments on-call lead.
4. Post a status update in #incidents every 30 minutes until resolved.
5. Write a postmortem within 5 working days.

## Postmortem: double payouts, November 2025

A retry storm in the payout service resent 1,200 payout requests after a network timeout. The requests had no
idempotency key, so 312 merchants were paid twice, and recovering the money took three weeks. The fix: the
`Idempotency-Key` header is now mandatory, and manual batch re-runs need the on-call lead. Lesson: when a payout looks
stuck, don't retry it; check the Ledger first to see whether it actually went through.

## On-call

- The payments on-call rota runs a week at a time, handing over on Monday at 10:00.
- Acknowledge a page within 5 minutes. If you can't, escalate to the secondary on-call immediately.
- Hand over every open incident in writing in #payments-oncall, even if you think it's resolved.

## Secrets and credentials

- Secrets live in the secrets manager, never in code, config files, tickets or Slack.
- If a secret is exposed (pushed to GitHub, pasted in chat), rotate it straight away and report it in
  #security-incidents. Deleting the message is not enough.
- Production database access is break-glass only, approved by the payments lead and logged.
