import { Evidence, ScoreBadge } from "@/components/ui/ScoreBadge";
import type { SubmitResult } from "@/services/grading";

/** What the hire sees after answering: verdict, scores with evidence, feedback, the cited policy and the expert answer. */
export function GradeDisplay({ result, answer }: { result: SubmitResult; answer?: string }) {
  const { grade, citation } = result;
  return (
    <div className="flex flex-col gap-3" data-testid="grade-display">
      <p className={`text-lg font-bold ${result.correct ? "text-emerald-700" : "text-red-700"}`}>
        {result.correct ? "It's super effective!" : "Ouch, that one hit you."}
      </p>

      {grade && answer && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(grade.scores).map(([competency, score]) => (
              <ScoreBadge key={competency} score={score} label={competency} />
            ))}
          </div>
          <blockquote className="border-l-4 border-ink/20 pl-3 text-sm">
            <Evidence answer={answer} quote={grade.evidenceQuote} />
          </blockquote>
          <p>{grade.feedback}</p>
          {grade.gap !== "none" && <p className="text-sm text-ink/70">Gap: {grade.gap}</p>}
        </>
      )}

      {!grade && !result.correct && result.correctChoice && (
        <p>
          The right answer: <strong>{result.correctChoice}</strong>
        </p>
      )}

      {result.expertAnswer && (
        <div className="rounded bg-emerald-50 p-3 text-sm">
          <p className="font-semibold">What an expert would do</p>
          <p>{result.expertAnswer}</p>
        </div>
      )}

      {citation && (
        <details className="rounded bg-ink/5 p-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            Source: {citation.docTitle} › {citation.heading} (v{citation.docVersion})
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{citation.text}</p>
        </details>
      )}

      {grade && (
        <p className="text-xs text-ink/50">
          Graded by {grade.modelVersion} ({grade.mode === "offline" ? "offline baseline" : grade.model}) in {grade.latencyMs}ms
          {grade.retrievedCorrections > 0 && ` · applied ${grade.retrievedCorrections} reviewer ruling(s)`}
        </p>
      )}
    </div>
  );
}
