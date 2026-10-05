"use client";

import { useState, useTransition } from "react";
import * as A from "../../actions";
import type { PathView } from "@/lib/pipeline";

type StepV = PathView["stages"][number]["steps"][number];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function PathClient({ view, videoError }: { view: PathView; videoError?: string }) {
  const { path, currentId, progress } = view;
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [, start] = useTransition();
  // videoError comes from the server render, so it stays current after every action's re-render.
  const shownError = error ?? videoError;

  const run = (label: string, fn: () => Promise<{ error?: string }>) => {
    setBusy(label);
    setError(undefined);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      setBusy(undefined);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted uppercase">
        <span className="capitalize">{path.level}</span>
        {!path.curated && <span className="rounded border border-line px-1.5 py-0.5">uncurated</span>}
      </div>
      <div className="flex items-end justify-between gap-4">
        <h1 className="font-display text-4xl leading-none font-extrabold uppercase italic sm:text-5xl">{path.skill}</h1>
        <span className="font-display text-4xl font-extrabold text-volt">{progress}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-volt transition-all" style={{ width: `${progress}%` }} />
      </div>

      {(busy || shownError) && (
        <div className={`sticky top-2 z-10 mt-4 rounded-xl border p-3 text-sm ${!busy ? "border-red-500/40 bg-red-950" : "border-volt/40 bg-panel"}`}>
          {busy ? <span className="animate-pulse">{busy}</span> : shownError}
        </div>
      )}

      <ol className="mt-8 space-y-10">
        {view.stages.map((stage, si) => (
          <li key={si} className="relative border-l-2 border-line pl-5">
            <div className="absolute top-1 -left-[9px] h-4 w-4 rounded-full border-2 border-volt bg-ink" />
            <div className="font-display text-sm font-semibold tracking-widest text-volt uppercase">Stage {si + 1}</div>
            <h2 className="font-display text-3xl font-extrabold uppercase">{stage.name}</h2>
            <p className="text-sm text-muted">{stage.goal}</p>
            <ol className="mt-4 space-y-3">
              {stage.steps.map((step) =>
                step.id === currentId ? (
                  <CurrentStep key={step.id} step={step} pathId={path.id} busy={!!busy} run={run} />
                ) : (
                  <li key={step.id} className={`flex items-center gap-3 rounded-xl border border-line px-4 py-3 ${step.status === "passed" ? "" : "opacity-40"}`}>
                    <span className={step.status === "passed" ? "text-volt" : "text-muted"}>{step.status === "passed" ? "✓" : "○"}</span>
                    <span className="font-medium">{step.data.title}</span>
                  </li>
                ),
              )}
            </ol>
          </li>
        ))}
      </ol>
      {currentId === null && <p className="mt-10 font-display text-4xl font-extrabold text-volt uppercase italic">Path complete. Goated. 🐐</p>}
    </div>
  );
}

function CurrentStep({ step, pathId, busy, run }: { step: StepV; pathId: number; busy: boolean; run: (l: string, f: () => Promise<{ error?: string }>) => void }) {
  const d = step.data;
  const v = step.video;
  const btn = "rounded-lg border border-line px-3 py-2 text-sm hover:border-volt disabled:opacity-40";
  return (
    <li className="overflow-hidden rounded-2xl border border-volt bg-panel">
      {v ? (
        <div>
          <div className="aspect-video bg-black">
            <iframe
              key={`${v.id}-${v.start}`}
              className="h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?start=${v.start}&rel=0`}
              title={v.title ?? "Demo video"}
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <div className="space-y-2 border-b border-line p-4">
            <div className="text-sm">
              <span className="font-medium">{v.title}</span> <span className="text-muted">· {v.channel} · starts {fmt(v.start)}</span>
            </div>
            {v.reason && <p className="text-xs text-muted">{v.reason}</p>}
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} className={btn} onClick={() => run("Swapping video…", () => A.swapVideo(step.id))}>
                ⇄ Swap video{step.backupsLeft ? ` (${step.backupsLeft})` : ""}
              </button>
              <button disabled={busy} className={btn} aria-label="Good video" onClick={() => run("Saved 👍", () => A.rateVideo(step.id, 1))}>👍</button>
              <button disabled={busy} className={btn} aria-label="Bad video, swap it" onClick={() => run("Finding a better video…", () => A.rateVideo(step.id, -1))}>👎</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex aspect-video items-center justify-center bg-black text-sm text-muted">
          <button disabled={busy} className={btn} onClick={() => run("Finding the best demo video…", () => A.ensureVideo(step.id))}>
            Find video
          </button>
        </div>
      )}

      <div className="space-y-5 p-4">
        <div>
          <h3 className="font-display text-3xl leading-tight font-extrabold uppercase">{d.title}</h3>
          <p className="text-sm text-muted">{d.why} · ~{Math.max(1, Math.round(d.estimatedSessions))} sessions</p>
        </div>

        <div>
          <h4 className="mb-2 font-display text-sm font-semibold tracking-widest text-muted uppercase">Drills</h4>
          <ul className="space-y-1.5">
            {d.drills.map((dr) => (
              <li key={dr.name} className="flex justify-between gap-4 rounded-lg bg-ink px-3 py-2 text-sm">
                <span>{dr.name}</span>
                <span className="shrink-0 font-display text-base font-semibold text-volt">{dr.dose}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Box title="Looks like" items={d.looksLike} tone="text-volt" mark="✓" />
          <Box title="Common mistakes" items={d.commonMistakes} tone="text-red-400" mark="✗" />
        </div>

        {d.safetyNote && <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">⚠️ {d.safetyNote}</p>}

        <div className="rounded-xl border border-dashed border-volt/60 p-4">
          <div className="font-display text-sm font-semibold tracking-widest text-volt uppercase">Pass test</div>
          <p className="mt-1 text-lg font-medium">{d.passTest}</p>
          <button disabled={busy} onClick={() => run("Nice. Next step…", () => A.passStep(step.id))} className="mt-3 w-full rounded-xl bg-volt py-3 font-display text-xl font-extrabold text-ink uppercase disabled:opacity-40">
            Passed ✓
          </button>
        </div>

        <div className="flex gap-2">
          <button disabled={busy} className={`${btn} flex-1`} onClick={() => run("Re-planning an easier route…", () => A.replan(pathId, "easier"))}>Too hard</button>
          <button disabled={busy} className={`${btn} flex-1`} onClick={() => run("Re-planning a harder route…", () => A.replan(pathId, "harder"))}>Too easy</button>
        </div>
      </div>
    </li>
  );
}

function Box({ title, items, tone, mark }: { title: string; items: string[]; tone: string; mark: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <h4 className={`mb-2 font-display text-sm font-semibold tracking-widest uppercase ${tone}`}>{title}</h4>
      <ul className="space-y-1 text-sm">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <span className={tone}>{mark}</span>
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
