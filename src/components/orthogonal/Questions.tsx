"use client";

import { useState, type ReactNode } from "react";

const primary = "h-[52px] flex-1 cursor-pointer rounded-xl border-0 bg-carbon text-base font-semibold text-white";
const secondary = "h-[52px] flex-1 cursor-pointer rounded-xl border-[1.5px] border-black/14 bg-white text-base font-semibold text-carbon hover:bg-[#f4f4f4]";

function QuestionCard({ bg, width, step, title, lead, children }: { bg: string; width: number; step: string; title: ReactNode; lead: string; children: ReactNode }) {
  return (
    <div className={`grid min-h-screen place-items-center p-5 md:p-10 ${bg}`}>
      <div className="animate-pop rounded-[22px] bg-white p-7 text-carbon shadow-[0_30px_80px_rgba(0,0,0,.25)] md:p-9" style={{ width: `min(${width}px, 100%)` }}>
        <div className="mb-2.5 text-[13px] font-semibold text-azure">{step}</div>
        <h2 className="mt-0 mb-2.5 text-[34px] leading-[1.05] font-semibold tracking-[-.02em]">{title}</h2>
        <p className="mt-0 mb-6 text-base leading-[1.45] text-black/60">{lead}</p>
        {children}
      </div>
    </div>
  );
}

export function GithubStage({ placeholder, onConnect, onSkip }: { placeholder: string; onConnect: (repo: string) => void; onSkip: () => void }) {
  const [repo, setRepo] = useState("");
  return (
    <QuestionCard
      bg="bg-azure"
      width={560}
      step="Step 2 of 4"
      title="Connect a GitHub repo?"
      lead="We'll read your components so the onboarding matches your code, and open a pull request when you're done."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConnect(repo.trim() || placeholder);
        }}
      >
        <label className="flex h-[54px] items-center gap-2 rounded-xl border-[1.5px] border-black/14 px-3.5 focus-within:border-azure">
          <span className="text-[15px] text-black/40">github.com/</span>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder={placeholder}
            aria-label="Repository (owner/name)"
            pattern="[\w.\-]+/[\w.\-]+"
            spellCheck={false}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-base outline-none"
          />
        </label>
        <div className="mt-[18px] flex flex-wrap gap-2.5">
          <button type="submit" className={primary}>
            Connect repo
          </button>
          <button type="button" onClick={onSkip} className={secondary}>
            Skip for now
          </button>
        </div>
      </form>
    </QuestionCard>
  );
}

interface DescribeProps {
  siteName: string;
  category: string;
  confidence: string;
  pageCount: number;
  onNext: (description: string) => void;
}

export function DescribeStage({ siteName, category, confidence, pageCount, onNext }: DescribeProps) {
  const [description, setDescription] = useState("");
  return (
    <QuestionCard
      bg="bg-marigold"
      width={600}
      step="Step 3 of 4"
      title={`We think ${siteName} is ${category}.`}
      lead={`Confidence is ${confidence} from ${pageCount} pages. Add anything we couldn't see.`}
    >
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Describe your users"
        placeholder="e.g. Most users are homeowners who just had panels installed. The hard step is pairing their inverter."
        className="min-h-[110px] w-full resize-y rounded-xl border-[1.5px] border-black/14 bg-white p-3.5 text-[15px] leading-[1.45] text-carbon outline-none focus:border-azure"
      />
      <div className="mt-[18px] flex flex-wrap gap-2.5">
        <button type="button" onClick={() => onNext("")} className={primary}>
          Sure, go ahead →
        </button>
        <button type="button" onClick={() => onNext(description.trim())} className={secondary}>
          Use my description
        </button>
      </div>
    </QuestionCard>
  );
}
