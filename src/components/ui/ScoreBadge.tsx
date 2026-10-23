const tone = ["bg-red-600 text-white", "bg-orange-500 text-white", "bg-amber-400 text-ink", "bg-emerald-600 text-white"];

export function ScoreBadge({ score, label }: { score: number; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-sm font-bold ${tone[score] ?? "bg-gray-500 text-white"}`}>
      {label && <span className="font-normal opacity-90">{label}</span>}
      {score}/3
    </span>
  );
}

/** Highlights the grader's evidence quote inside the answer. */
export function Evidence({ answer, quote }: { answer: string; quote: string }) {
  const i = quote ? answer.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  if (i === -1) return <span>{answer}</span>;
  return (
    <span>
      {answer.slice(0, i)}
      <mark className="rounded bg-gold/60 px-0.5">{answer.slice(i, i + quote.length)}</mark>
      {answer.slice(i + quote.length)}
    </span>
  );
}
