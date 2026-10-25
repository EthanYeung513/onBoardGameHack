"use client";

import { Editable } from "./Editable";
import type { CoursePatch } from "./contracts";

// The branded page inside the browser chrome (editor.html `renderPage`), drawn from a CourseSpec step.

export type SpecOption = { label: string; correct?: boolean };
export type SpecStep = { id: string; kind: string; title: string; body?: string; options?: SpecOption[] };

export const KIND_LABEL: Record<string, string> = {
  welcome: "Welcome screen",
  fields: "Fields",
  lesson: "Lesson",
  quiz: "Quiz",
  scenario: "Scenario",
  checklist: "Checklist",
  done: "Completion",
};

type Props = {
  steps: SpecStep[];
  cur: number;
  building: string;
  onPatch: (patch: CoursePatch) => Promise<boolean>;
};

function XpRow({ n, total }: { n: number; total: number }) {
  const pct = Math.round((n / total) * 100);
  return (
    <div className="xp-row">
      <div className="xpbar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="xp-t">{n * 20} XP</span>
      <span className="lvl">Lvl 1 · Rookie</span>
    </div>
  );
}

export function Preview({ steps, cur, building, onPatch }: Props) {
  const s = steps[cur];
  if (!s) return null;
  const at = `/steps/${cur}`;
  const set = (path: string) => (value: string) => onPatch({ op: "set", path: `${at}${path}`, value });
  const options = s.options ?? [];
  const choice = s.kind === "quiz" || s.kind === "scenario";

  return (
    <>
      <XpRow n={cur + 1} total={steps.length} />
      <div className="stepno">
        Step {cur + 1} of {steps.length}
      </div>
      <h2>
        <Editable key={`${s.id}-t`} value={s.title} onCommit={set("/title")} label="Step title" />
      </h2>
      {s.body !== undefined && (
        <div className="bsub">
          <Editable key={`${s.id}-b`} value={s.body} onCommit={set("/body")} label="Step text" multiline />
        </div>
      )}
      {options.length > 0 &&
        (s.kind === "fields" ? (
          <div className="fields">
            {options.map((o, j) => (
              <div className="fld" key={`${s.id}-${j}`}>
                <label>
                  <Editable value={o.label} onCommit={set(`/options/${j}/label`)} label={`Field ${j + 1}`} />
                </label>
                <div className="v">&nbsp;</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="opts">
            {options.map((o, j) => (
              <div className={`opt${choice && o.correct ? " picked" : ""}`} key={`${s.id}-${j}`}>
                <Editable value={o.label} onCommit={set(`/options/${j}/label`)} label={`Option ${j + 1}`} />
              </div>
            ))}
          </div>
        ))}
      <div className="unlock">
        <span>UNLOCKS</span>
        <b>{building} badge</b>
      </div>
      <div className="bnav">
        <span className="bback">Back</span>
        <span className="bnext">Continue · +20 XP</span>
      </div>
    </>
  );
}
