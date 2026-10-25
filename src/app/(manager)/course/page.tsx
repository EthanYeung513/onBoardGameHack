"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { brandVars } from "@/components/manager/brand";
import { Icon } from "@/components/manager/icons";
import "./course.css";

// course.html, ported: /course?id=<courseId>. Overview (outcomes + course plan) then one slide per
// lesson, from the course's real CourseSpec steps. The assistant panel edits the course through
// the same validated patches as the editor (courses.applyPatch).

type Step = { id: string; kind: string; title: string; body?: string; options?: { label: string; correct?: boolean; why?: string }[] };

const OUTCOMES = ["Understand the core concepts covered in this course", "Apply what you learn inside the game world", "Recall key people, tools and terms on the job"];
const KIND: Record<string, string> = { lesson: "Lesson", quiz: "Quiz", scenario: "Scenario", checklist: "Checklist", fields: "Your details" };

type Msg = { who: "you" | "agent"; text: string };

function CourseView() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id") as Id<"courses"> | null;
  const course = useQuery(api.courses.get, id ? { courseId: id } : "skip");
  const space = useQuery(api.spaces.get, course ? { spaceId: course.spaceId } : "skip");
  const patch = useMutation(api.courses.applyPatch);
  const [slide, setSlide] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [toast, setToast] = useState("");
  const msgEnd = useRef<HTMLDivElement>(null);

  const steps: Step[] = ((course?.spec as { steps?: Step[] } | undefined)?.steps ?? []).filter((s) => s.kind !== "welcome" && s.kind !== "done");
  const n = steps.length;
  const go = useCallback((d: number) => setSlide((s) => Math.min(n, Math.max(0, s + d))), [n]);

  useEffect(() => {
    if (!id) router.replace("/dashboard?tab=courses");
  }, [id, router]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go]);
  useEffect(() => msgEnd.current?.scrollIntoView({ block: "end" }), [msgs]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  if (!course) return <div className="cw" />;
  const say = (text: string) => setMsgs((m) => [...m, { who: "agent", text }]);

  async function apply(ops: { op: "set" | "remove"; path: string; value?: unknown }[], done: string) {
    try {
      await patch({ courseId: course!._id, version: course!.version, patches: ops });
      say(done);
    } catch (err) {
      say(err instanceof ConvexError ? (err.data as { message: string }).message : "That change didn't go through. Please try again.");
    }
  }

  async function ask() {
    const q = input.trim();
    if (!q) return;
    setInput("");
    setMsgs((m) => [...m, { who: "you", text: q }]);
    const all = ((course!.spec as { steps?: Step[] }).steps ?? []) as Step[];
    if (/^(rename|retitle|call it)\b/i.test(q)) {
      const title = q.replace(/^(rename|retitle|call it)\s*(the course|it|this course)?\s*(to|as)?\s*/i, "").trim();
      if (!title) return say("What should I rename it to?");
      return apply([{ op: "set", path: "/title", value: title }], `Renamed the course to "${title}".`);
    }
    if (/^(remove|delete|drop|take out)\b/i.test(q)) {
      const kw = q.replace(/^(remove|delete|drop|take out)\s*(the\s*)?(lesson\s*)?(on\s*)?/i, "").toLowerCase();
      const idx = all.findIndex((s) => s.kind !== "welcome" && s.kind !== "done" && s.title.toLowerCase().includes(kw));
      if (idx < 0) return say("I could not find a lesson matching that. Try quoting its name.");
      if (slide > n - 1) setSlide(Math.max(0, n - 1));
      return apply([{ op: "remove", path: `/steps/${idx}` }], `Removed "${all[idx].title}".`);
    }
    say("I can rename the course or remove a lesson here. Drafting new lessons from your company brain is coming to this panel next.");
  }

  const step = slide > 0 ? steps[slide - 1] : null;
  return (
    <div className={`course-page${aiOpen ? " ai-open" : ""}`} style={brandVars(space?.brand)}>
      <div className="cw">
        <Link className="back" href={`/dashboard?space=${course.spaceId}&tab=courses`}>
          <Icon name="back" /> Back to courses
        </Link>
        <div className="kind">COURSE · {String(course.game).toUpperCase()} GAME</div>
        <div className="title-line">
          <h1 id="c-title">{course.title}</h1>
          <div className="nav-arrows">
            <button className="arrow-btn" id="prev" onClick={() => go(-1)} title="Previous" disabled={slide === 0}>
              <Icon name="left" />
            </button>
            <span className="cnt" id="cnt">
              {slide === 0 ? "Overview" : `${slide} / ${n}`}
            </span>
            <button className="arrow-btn" id="next" onClick={() => go(1)} title="Next" disabled={slide === n}>
              <Icon name="right" />
            </button>
            <button className={`panel-btn${aiOpen ? " on" : ""}`} id="ai-toggle" onClick={() => setAiOpen((o) => !o)} title="AI assistant">
              <Icon name="sidepanel" />
            </button>
          </div>
        </div>
        <div className="sub">{(course.spec as { desc?: string })?.desc ?? ""}</div>
        <div id="slide">
          {!step ? (
            <>
              <div className="meta-row">
                <span className="pill">{course.building}</span>
                <span className="pill">{n} lessons</span>
                <span className={`pill${course.status === "published" ? " live" : ""}`}>{course.status === "published" ? "Published" : "Draft"}</span>
              </div>
              <h2>Learning outcomes</h2>
              <ul className="outcomes">
                {OUTCOMES.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
              <h2>Course plan</h2>
              <ul className="plan">
                {steps.map((s, i) => (
                  <li key={s.id}>
                    <span className="n">{i + 1}.</span>
                    {s.title}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="lesson-card">
              <div className="lno">
                {(KIND[step.kind] ?? "Lesson").toUpperCase()} {slide} OF {n}
              </div>
              <h3>{step.title}</h3>
              {step.body && (
                <ul>
                  {step.body
                    .split(/\n+/)
                    .filter(Boolean)
                    .map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                </ul>
              )}
              {step.options?.length ? (
                <div className="check">
                  <b>{step.kind === "scenario" ? "What would you do?" : "Check"}</b>
                  <ul className="opts">
                    {step.options.map((o) => (
                      <li key={o.label} className={o.correct ? "ok" : undefined}>
                        {o.correct ? "✓ " : ""}
                        {o.label}
                        {o.correct && o.why ? <span className="why"> {o.why}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div id="ai-side">
        <div className="hd">
          <span className="t">Assistant</span>
          <button onClick={() => setAiOpen(false)} title="Close">
            <Icon name="x" />
          </button>
        </div>
        <div id="ai-msgs">
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.who}`}>
              {m.text}
            </div>
          ))}
          <div ref={msgEnd} />
        </div>
        <div id="ai-in">
          <div className="box">
            <textarea
              id="ai-input"
              placeholder="Ask to change this course…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask();
                }
              }}
            />
            <div className="row">
              <span className="agent-mini">Mubit</span>
              <span style={{ flex: 1 }} />
              <button className="send" onClick={() => void ask()} title="Send">
                <Icon name="up" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className={`toast${toast ? " show" : ""}`}>{toast}</div>
    </div>
  );
}

export default function CoursePage() {
  return (
    <Suspense fallback={<div className="cw" />}>
      <CourseView />
    </Suspense>
  );
}
