import type { CardType, PackType, Rubric } from "../../src/db/schema";

/** A card as authored: its source is a doc slug + section heading, resolved to a chunk id at seed time. */
export interface CardSpec {
  type: CardType;
  competency: string;
  prompt: string;
  choices?: string[];
  answerIdx?: number;
  source: { doc: string; heading: string };
  rubric?: Omit<Rubric, "policy" | "competency" | "levels"> & { levels?: Rubric["levels"] };
  expertAnswer?: string;
  isBoss?: boolean;
}

export interface PackSpec {
  slug: string;
  type: PackType;
  role: string | null;
  title: string;
  docs: { slug: string; file: string }[];
  gym: { name: string; leaderName: string; building: string; order: number; locked?: boolean };
  cards: CardSpec[];
}

export interface WorldSpec {
  company: { name: string; slug: string; joinCode: string };
  roles: string[];
  packs: PackSpec[];
}

export const defaultLevels: Rubric["levels"] = {
  "0": "Breaks company policy or would put customers, money or data at risk.",
  "1": "Safe, but misses most of the steps the policy requires.",
  "2": "Mostly follows policy but misses one key step.",
  "3": "Follows company policy fully and explains why.",
};

const security = (heading: string) => ({ doc: "security-policy", heading });
const support = (heading: string) => ({ doc: "support-playbook", heading });
const runbook = (heading: string) => ({ doc: "payments-runbook", heading });
const handbook = (heading: string) => ({ doc: "company-handbook", heading });

export const acmePay: WorldSpec = {
  company: { name: "Acme Pay", slug: "acme-pay", joinCode: "ACME" },
  roles: ["Customer Support", "Engineering", "Operations", "Sales"],
  packs: [
    {
      slug: "company",
      type: "company",
      role: null,
      title: "Company basics",
      docs: [{ slug: "company-handbook", file: "company-handbook.md" }],
      gym: { name: "Town Hall", leaderName: "Mayor Bloom", building: "townhall", order: 0 },
      cards: [
        {
          type: "mcq",
          competency: "expenses",
          prompt: "You're travelling for work and dinner costs £42. What can you claim?",
          choices: [
            "£42, it was a work trip",
            "£30, with an itemised receipt",
            "£30 today and the other £12 on tomorrow's claim",
            "Nothing, meals aren't covered",
          ],
          answerIdx: 1,
          source: handbook("Expenses"),
        },
        {
          type: "free_text",
          competency: "escalation",
          prompt:
            "You think a merchant's money might be at risk, but your team lead is on holiday this week. What do you do?",
          source: handbook("Escalation"),
          rubric: {
            signals: [["#security-incidents", "security-incidents", "escalate"], ["straight away", "now", "immediately", "don't wait", "right away"]],
            redFlags: ["wait for my lead", "wait until", "next week"],
          },
          expertAnswer:
            "Escalate straight away in #security-incidents. When a customer's money is at risk I don't need to wait for my lead, and nobody is blamed for escalating something that turns out fine.",
          isBoss: true,
        },
      ],
    },
    {
      slug: "security",
      type: "compliance",
      role: null,
      title: "Security and compliance",
      docs: [{ slug: "security-policy", file: "security-policy.md" }],
      gym: { name: "Security HQ", leaderName: "Officer Vale", building: "security", order: 1 },
      cards: [
        {
          type: "mcq",
          competency: "phishing-response",
          prompt:
            "An email from 'IT Support' says your password expires in 1 hour and links to a login page. What do you do?",
          choices: [
            "Click the link and change it quickly",
            "Report it with the Report Phish button and don't click",
            "Forward it to your team to warn them",
            "Reply and ask if it's real",
          ],
          answerIdx: 1,
          source: security("Suspicious emails and phishing"),
        },
        {
          type: "free_text",
          competency: "phishing-response",
          prompt:
            "Your CEO emails you from a personal Gmail address: \"I'm stuck in a meeting. Buy £500 of gift cards for a client today and send me the codes.\" What do you do?",
          source: security("Suspicious emails and phishing"),
          rubric: {
            signals: [
              ["not buy", "won't buy", "don't buy", "refuse", "decline", "ignore the request"],
              ["verify", "call", "phone", "in person", "known number", "on file"],
              ["report phish", "report it", "report the email", "security"],
            ],
            redFlags: ["buy the gift cards", "send the codes", "send him the codes", "send her the codes"],
          },
          expertAnswer:
            "I don't buy anything or reply. Urgent payment requests are verified through a channel I already know, so I'd check with the CEO's office in person or on a known number, and report the email with the Report Phish button.",
        },
        {
          type: "mcq",
          competency: "gifts",
          prompt: "A supplier currently bidding for our cleaning contract offers you two £40 concert tickets. What do you do?",
          choices: [
            "Accept, they're under £50",
            "Accept and record them in the gift register",
            "Politely decline: they're in an active tender",
            "Accept if your manager agrees",
          ],
          answerIdx: 2,
          source: security("Gifts and hospitality"),
        },
        {
          type: "free_text",
          competency: "physical-security",
          prompt:
            "Someone with no visible badge, carrying a stack of boxes, asks you to hold the secure office door for them. What do you do?",
          source: security("Office access and visitors"),
          rubric: {
            signals: [["badge", "ask to see"], ["reception"], ["don't let", "not let", "won't let", "close the door", "not hold"]],
            redFlags: ["hold the door for them", "let them in", "help them in"],
          },
          expertAnswer:
            "I politely ask to see their badge. If they don't have one, I direct them to reception and don't let them follow me through, even though it feels unhelpful.",
        },
        {
          type: "free_text",
          competency: "incident-reporting",
          prompt:
            "At 5:45pm on a Friday you realise you typed your password into a fake DocuSign page from an email. What do you do now?",
          source: security("Reporting incidents"),
          rubric: {
            signals: [
              ["#security-incidents", "security-incidents", "security team", "report"],
              ["straight away", "immediately", "right away", "now", "tonight", "within 1 hour", "within an hour"],
              ["don't delete", "not delete", "keep the email", "evidence"],
            ],
            redFlags: ["wait until monday", "on monday", "delete the email", "ignore it"],
          },
          expertAnswer:
            "Report it in #security-incidents right now, not on Monday: incidents must be reported within an hour. I keep the email as evidence and let the security team investigate.",
          isBoss: true,
        },
        {
          type: "phish_email",
          competency: "phishing-response",
          prompt:
            "From: payroll@acmepay-hr.example\nSubject: URGENT: confirm your bank details today\n\nYour salary payment failed. Confirm your bank details within 2 hours or your pay will be delayed: http://acmepay-hr.example/confirm",
          choices: ["Phish: report it", "Legit: safe to act on"],
          answerIdx: 0,
          source: security("Suspicious emails and phishing"),
        },
        {
          type: "phish_email",
          competency: "phishing-response",
          prompt:
            "From: ceo.acmepay@gmail.example\nSubject: Quick favour\n\nAre you at your desk? I need you to handle a confidential payment for me before 4pm. Don't mention it to anyone yet.",
          choices: ["Phish: report it", "Legit: safe to act on"],
          answerIdx: 0,
          source: security("Suspicious emails and phishing"),
        },
        {
          type: "phish_email",
          competency: "phishing-response",
          prompt:
            "From: people-team@acmepay.example\nSubject: Your onboarding week schedule\n\nWelcome to Acme Pay! Your schedule for this week is in the People section of the intranet. No action needed.",
          choices: ["Phish: report it", "Legit: safe to act on"],
          answerIdx: 1,
          source: security("Suspicious emails and phishing"),
        },
      ],
    },
    {
      slug: "support",
      type: "role",
      role: "Customer Support",
      title: "Customer Support",
      docs: [{ slug: "support-playbook", file: "support-playbook.md" }],
      gym: { name: "Support Gym", leaderName: "Lead Rosa", building: "support", order: 2 },
      cards: [
        {
          type: "mcq",
          competency: "refunds",
          prompt: "A merchant asks for a £400 refund for a faulty terminal. What can you do?",
          choices: [
            "Approve it now",
            "Tell them it's approved and submit it later",
            "Raise it for team-lead approval and don't promise a date",
            "Refund it to whichever card they prefer",
          ],
          answerIdx: 2,
          source: support("Refunds"),
        },
        {
          type: "free_text",
          competency: "account-security",
          prompt:
            "A merchant emails from their registered address: \"We've switched banks. Please update our payout account to the details below today. The owner is travelling and we can't miss Friday's payout.\" How do you handle it?",
          source: support("Bank detail changes"),
          rubric: {
            signals: [
              ["call back", "callback", "phone number on file", "number on file", "call them on"],
              ["app", "two-factor", "2fa"],
              ["fraud", "flag"],
              ["24-hour hold", "24 hour hold", "hold on payouts", "payout hold"],
            ],
            redFlags: ["update the details", "change the account now", "update it today", "since it's from their registered"],
          },
          expertAnswer:
            "I don't change anything from the email, even though it's from the registered address. I call the merchant back on the phone number on file and they approve the change in the app with two-factor authentication. The change puts a 24-hour hold on payouts, and the pressure to rush it is a fraud signal, so I flag the account to the fraud team.",
        },
        {
          type: "free_text",
          competency: "vulnerable-customers",
          prompt:
            "A merchant on the phone tells you her husband, who ran the business, died last month, and she can't make sense of the fees being collected. How do you handle the call?",
          source: support("Vulnerable customers"),
          rubric: {
            signals: [["sorry", "listen", "slow down", "take my time"], ["pause", "30 days"], ["flag", "vulnerab"], ["consent", "permission"]],
            redFlags: ["fees are still due", "she must pay", "can't help"],
          },
          expertAnswer:
            "I slow down, say I'm sorry and listen. I offer to pause collections for 30 days and, with her consent, add a vulnerability flag so she doesn't have to repeat her story. I don't push her to decide anything on the call.",
        },
        {
          type: "mcq",
          competency: "account-security",
          prompt: "A caller fails the postcode check and says: \"Just give me a hint, it's my own business.\" What do you do?",
          choices: [
            "Give them the first two characters",
            "Ask for their card number instead",
            "Give no hints and offer a callback on the number on file",
            "Skip the check this once",
          ],
          answerIdx: 2,
          source: support("Identity checks"),
        },
        {
          type: "free_text",
          competency: "complaints",
          prompt:
            "A merchant says: \"This is the third time my payout has been late. If it isn't fixed I'm going to the Financial Ombudsman.\" What do you do?",
          source: support("Complaints"),
          rubric: {
            signals: [["acknowledge", "24 hours"], ["escalate", "team lead", "complaints team"], ["log", "register"], ["same day", "today"]],
            redFlags: ["nothing we can do", "ignore"],
          },
          expertAnswer:
            "I acknowledge the complaint, log it in the Complaints register, and because they mentioned the Financial Ombudsman I escalate to the complaints team lead the same day.",
          isBoss: true,
        },
        {
          type: "free_text",
          competency: "refunds",
          prompt:
            "A merchant wants a £600 refund paid into a new bank account because the card they originally paid with has been cancelled. What do you do?",
          source: support("Refunds"),
          rubric: {
            signals: [["team lead", "team-lead", "approval"], ["original payment method", "original card", "original method"], ["not promise", "don't promise", "no date"]],
            redFlags: ["to the new bank account", "different account", "approve it myself"],
          },
          expertAnswer:
            "Over £250 needs team-lead approval, so I raise it in the Refunds queue and don't promise a date. Refunds only go back to the original payment method, never to a new account.",
          isBoss: true,
        },
      ],
    },
    {
      slug: "engineering",
      type: "role",
      role: "Engineering",
      title: "Payments Engineering",
      docs: [{ slug: "payments-runbook", file: "payments-runbook.md" }],
      gym: { name: "Engineering Gym", leaderName: "Guardian Okafor", building: "engineering", order: 3 },
      cards: [
        {
          type: "mcq",
          competency: "ledger-safety",
          prompt: "Which service is the source of truth for merchant balances?",
          choices: ["The gateway", "The Ledger", "The payout service", "The data warehouse"],
          answerIdx: 1,
          source: runbook("Architecture"),
        },
        {
          type: "mcq",
          competency: "ledger-safety",
          prompt: "It's 01:45 and your Ledger fix has been approved. When can you deploy it?",
          choices: ["Now", "After 03:00", "At 02:00, alongside reconciliation", "Any time, as long as rollback is ready"],
          answerIdx: 1,
          source: runbook("Ledger rules"),
        },
        {
          type: "free_text",
          competency: "incident-response",
          prompt: "Payout errors spike right after your Ledger deploy. What do you do first, and why?",
          source: runbook("Failed deploy runbook"),
          rubric: {
            signals: [["roll back", "rollback", "deploy rollback ledger"], ["dashboard", "#deploys", "check"], ["not hotfix", "don't hotfix", "no hotfix"], ["page", "on-call"]],
            redFlags: ["hotfix forward", "patch the database", "write to the ledger database"],
          },
          expertAnswer:
            "Check #deploys and the Payments dashboard, then roll back first with `deploy rollback ledger --to previous`. We never hotfix forward on the Ledger. If payouts stay stuck for 15 minutes, page the payments on-call lead.",
        },
        {
          type: "free_text",
          competency: "incident-response",
          prompt:
            "A merchant's payout has looked stuck for 20 minutes. A teammate suggests re-running the payout batch to push it through. What do you do?",
          source: runbook("Postmortem: double payouts, November 2025"),
          rubric: {
            signals: [["don't re-run", "do not re-run", "not re-run", "shouldn't re-run", "no re-run"], ["check the ledger", "ledger first", "went through"], ["page", "on-call"], ["idempotency"]],
            redFlags: ["re-run the batch", "retry the payout", "rerun it"],
          },
          expertAnswer:
            "Don't re-run the batch: that's how 312 merchants were paid twice in November 2025. Check the Ledger first to see whether the payout went through. It's been stuck over 15 minutes, so page the payments on-call lead, who is the only one allowed to re-run a batch.",
          isBoss: true,
        },
      ],
    },
  ],
};
