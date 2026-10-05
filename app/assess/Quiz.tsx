"use client";

import { useState, useTransition } from "react";
import { submitAssessment } from "../actions";
import { placeLevel, type Level } from "@/lib/levels";
import type { Assessment } from "@/lib/pipeline";

export default function Quiz({ skill, curated, questions }: { skill: string; curated: boolean; questions: Assessment["questions"] }) {
  const [answers, setAnswers] = useState<Level[]>([]);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const done = answers.length === questions.length;
  const q = questions[answers.length];

  const answer = (level: Level) => {
    const next = [...answers, level];
    setAnswers(next);
    if (next.length === questions.length) {
      start(async () => {
        const r = await submitAssessment(skill, placeLevel(next));
        if (r?.error) setError(r.error);
      });
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted uppercase">
        <span className="font-display text-base font-semibold tracking-wide">{skill}</span>
        {!curated && <span className="rounded border border-line px-1.5 py-0.5">uncurated</span>}
      </div>
      <div className="mt-3 flex gap-1.5">
        {questions.map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < answers.length ? "bg-volt" : "bg-line"}`} />
        ))}
      </div>

      {!done && q && (
        <div className="mt-8">
          <h1 className="font-display text-3xl leading-tight font-extrabold uppercase sm:text-4xl">{q.question}</h1>
          <div className="mt-6 grid gap-3">
            {q.options.map((o) => (
              <button key={o.label} onClick={() => answer(o.level)} className="rounded-xl border border-line bg-panel px-4 py-4 text-left text-lg hover:border-volt active:scale-[.99]">
                {o.label}
              </button>
            ))}
          </div>
          {answers.length > 0 && (
            <button onClick={() => setAnswers(answers.slice(0, -1))} className="mt-4 text-sm text-muted hover:text-white">
              ← Back
            </button>
          )}
        </div>
      )}

      {done && (
        <div className="mt-10">
          <p className="font-display text-3xl uppercase italic">
            You&apos;re starting at <span className="text-volt">{placeLevel(answers)}</span>.
          </p>
          {pending && <p className="mt-2 animate-pulse text-muted">Building your path… (first time for a skill takes ~30–60 s)</p>}
          {error && (
            <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
              {error}
              <button onClick={() => { setError(undefined); setAnswers(answers.slice(0, -1)); }} className="ml-3 underline">Try again</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
