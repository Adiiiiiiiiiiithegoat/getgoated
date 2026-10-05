import { z } from "zod";
import { db } from "./db";
import { askJSON, TRANSCRIPT_CHARS } from "./llm";
import { chapters, getTranscript, getVideos, searchIds, type VideoMeta } from "./youtube";

// ---------- curated skills ----------

const LIFT_SAFETY =
  "Every step MUST have a safetyNote covering: a warm-up (e.g. empty bar + ramp-up sets), a load increase rule (e.g. add the smallest increment only after all sets hit target reps with good form), and 'stop immediately on sharp pain'.";

export const CURATED: { name: string; group?: string; outline: string }[] = [
  {
    name: "Freestyle swimming",
    outline:
      "body position / floating → kick → breathing (incl. bilateral) → arm stroke / catch → full stroke + endurance. Example pass test: '25 m bilateral breathing without stopping'.",
  },
  {
    name: "8-ball pool",
    outline:
      "stance, bridge, straight stroke → aiming → cue-ball control (stop, stun, draw, follow) → position play → safety play & break. Example pass test: '8/10 straight-in stop shots'.",
  },
  {
    name: "Basketball",
    outline:
      "shooting form → free throws → ball handling (both hands) → layups (both sides) → shooting off the dribble. Example pass tests: '7/10 free throws', '10 weak-hand layups in a row'.",
  },
  { name: "Squat", group: "Gym", outline: `form → technique cues → progression plan. ${LIFT_SAFETY}` },
  { name: "Bench press", group: "Gym", outline: `form → technique cues → progression plan. ${LIFT_SAFETY}` },
  { name: "Deadlift", group: "Gym", outline: `form → technique cues → progression plan. ${LIFT_SAFETY}` },
  {
    name: "Pull-ups",
    group: "Gym",
    outline: `start from dead hangs / scapular pulls / negatives if needed → first full rep → sets of reps → progression plan. ${LIFT_SAFETY}`,
  },
];

const ALIASES: Record<string, string> = { swimming: "Freestyle swimming", freestyle: "Freestyle swimming", pool: "8-ball pool", "8 ball pool": "8-ball pool", "8-ball": "8-ball pool", "pull ups": "Pull-ups", pullups: "Pull-ups", bench: "Bench press" };

/** Canonical skill name: curated name if it matches, else the trimmed input. */
export function canonicalSkill(input: string): string {
  const k = input.trim().toLowerCase().replace(/\s+/g, " ");
  return CURATED.find((c) => c.name.toLowerCase() === k)?.name ?? ALIASES[k] ?? input.trim().replace(/\s+/g, " ");
}
const curatedFor = (skill: string) => CURATED.find((c) => c.name === skill);

// ---------- schemas ----------

import { LEVELS, type Level } from "./levels";
export { LEVELS, placeLevel, type Level } from "./levels";

const AssessmentSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.object({ label: z.string(), level: z.enum(LEVELS) })),
    }),
  ),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

const StepSchema = z.object({
  title: z.string(),
  why: z.string(),
  drills: z.array(z.object({ name: z.string(), dose: z.string().describe("sets/reps/duration, e.g. '4 x 25 m' or '3 x 8 reps'") })),
  looksLike: z.array(z.string()),
  commonMistakes: z.array(z.string()),
  passTest: z.string(),
  estimatedSessions: z.number(), // not .int(): a "2.5" shouldn't cost a full retry; rounded on display
  safetyNote: z.string().nullable(),
  searchQueries: z.array(z.string()),
});
export type Step = z.infer<typeof StepSchema>;

const PlanSchema = z.object({
  stages: z.array(z.object({ name: z.string(), goal: z.string(), steps: z.array(StepSchema) })),
});
type Plan = z.infer<typeof PlanSchema>;

const COACH = "You are an elite, safety-conscious coach who designs progressive skill paths for adult self-learners practising on their own.";

// ---------- assessment ----------

export async function getAssessment(skill: string): Promise<Assessment> {
  const hit = db.prepare("SELECT json FROM assessments WHERE skill = ? COLLATE NOCASE").get(skill) as { json: string } | undefined;
  if (hit) return JSON.parse(hit.json);
  const a = await askJSON({
    schema: AssessmentSchema,
    system: COACH,
    effort: "low",
    prompt: `Write 3–4 multiple-choice questions that place a learner of "${skill}" at beginner, intermediate or advanced level.
Rules:
- Each question must be concrete and observable, e.g. "Can you swim 25 m freestyle without stopping?" — never "How would you rate yourself?".
- 2–4 short options per question, each tagged with the level it indicates. Order options from least to most skilled.
- Cover different sub-skills so the questions don't all measure the same thing.`,
    check: (d) =>
      d.questions.length < 3 || d.questions.length > 4 ? "Need 3–4 questions." : d.questions.some((q) => q.options.length < 2) ? "Every question needs ≥2 options." : null,
  });
  db.prepare("INSERT OR REPLACE INTO assessments (skill, json) VALUES (?, ?)").run(skill, JSON.stringify(a));
  return a;
}

// ---------- plan ----------

const STAGES_FOR: Record<Level, string> = {
  beginner: "Foundation → Core → Advanced",
  intermediate: "Core → Advanced (assume Foundation is solid; at most one quick Foundation check-in step inside Core)",
  advanced: "Advanced only — refinement, power/efficiency, and performance under pressure (1–2 stages)",
};

function planRules(skill: string) {
  const c = curatedFor(skill);
  return `${c ? `Curated outline to follow for "${skill}": ${c.outline}\n` : ""}Rules:
- 2–4 steps per stage, 10 steps max in total. Each step is ONE technique, in the order it should be learned.
- passTest must be concrete and measurable by the learner alone (counts, distances, times, "x/10"), never "feel comfortable".
- drills: 2–4, each with an exact dose (sets/reps/distance/duration).
- looksLike: 3–5 short correct-form cues. commonMistakes: 2–4.
- safetyNote: required whenever there is injury or drowning risk; otherwise null.
- searchQueries: 2–3 short YouTube searches (3–7 words) that would find a video DEMONSTRATING this exact technique or drill, phrased the way coaches title videos (e.g. "freestyle bilateral breathing drill"). Never include URLs.`;
}

export async function generatePlan(skill: string, level: Level): Promise<Plan> {
  return askJSON({
    schema: PlanSchema,
    system: COACH,
    effort: "medium",
    prompt: `Design an improvement path for "${skill}" for a ${level}.
Stages: ${STAGES_FOR[level]}.
${planRules(skill)}`,
    check: (p) => (p.stages.length === 0 || p.stages.some((s) => s.steps.length === 0) ? "Every stage needs at least one step." : null),
  });
}

function insertSteps(pathId: number, stageOffset: number, stages: Plan["stages"], stepOffsetFirst = 0) {
  const ins = db.prepare("INSERT INTO steps (path_id, stage_idx, step_idx, data_json) VALUES (?, ?, ?, ?)");
  stages.forEach((st, si) =>
    st.steps.forEach((step, i) => ins.run(pathId, stageOffset + si, (si === 0 ? stepOffsetFirst : 0) + i, JSON.stringify(step))),
  );
}

// Case-insensitive so "javelin throw" and "Javelin throw" share one path / assessment.
const findPath = (skill: string, level: Level) =>
  (db.prepare("SELECT id FROM paths WHERE skill = ? COLLATE NOCASE AND level = ?").get(skill, level) as { id: number } | undefined)?.id;

/** Returns the path id for skill+level, generating the plan if needed. */
export async function getOrCreatePath(skill: string, level: Level): Promise<number> {
  const hit = findPath(skill, level);
  if (hit) return hit;
  const plan = await generatePlan(skill, level);
  const stagesMeta = plan.stages.map(({ name, goal }) => ({ name, goal }));
  return db.transaction(() => {
    const raced = findPath(skill, level); // a concurrent request may have finished first
    if (raced) return raced;
    const id = Number(
      db.prepare("INSERT INTO paths (skill, level, curated, plan_json) VALUES (?, ?, ?, ?)").run(skill, level, curatedFor(skill) ? 1 : 0, JSON.stringify({ stages: stagesMeta })).lastInsertRowid,
    );
    insertSteps(id, 0, plan.stages);
    return id;
  })();
}

// ---------- reads ----------

export type StepRow = {
  id: number; path_id: number; stage_idx: number; step_idx: number; data_json: string;
  video_id: string | null; start_seconds: number | null; video_reason: string | null;
  backups_json: string; seen_json: string; status: string; passed_at: string | null;
};
export type PathRow = { id: number; skill: string; level: Level; curated: number; created_at: string; started_at: string | null; plan_json: string };

const stepsOf = (pathId: number) =>
  db.prepare("SELECT * FROM steps WHERE path_id = ? ORDER BY stage_idx, step_idx").all(pathId) as StepRow[];
function stepRow(id: number): StepRow {
  const row = db.prepare("SELECT * FROM steps WHERE id = ?").get(id) as StepRow | undefined;
  if (!row) throw new Error("That step no longer exists (the path was re-planned). Refresh the page.");
  return row;
}

/** Path that owns a step; actions use this instead of trusting a client-supplied path id. */
export const pathOfStep = (stepId: number) => stepRow(stepId).path_id;

export async function getPathView(id: number) {
  const path = db.prepare("SELECT * FROM paths WHERE id = ?").get(id) as PathRow | undefined;
  if (!path) return null;
  const rows = stepsOf(id);
  const metas = await getVideos(rows.flatMap((r) => (r.video_id ? [r.video_id] : []))); // all cached after selection: 0 quota
  const { stages } = JSON.parse(path.plan_json) as { stages: { name: string; goal: string }[] };
  const currentId = rows.find((r) => r.status !== "passed")?.id ?? null;
  return {
    path,
    currentId,
    progress: rows.length ? Math.round((100 * rows.filter((r) => r.status === "passed").length) / rows.length) : 0,
    stages: stages.map((s, si) => ({
      ...s,
      steps: rows
        .filter((r) => r.stage_idx === si)
        .map((r) => ({
          id: r.id,
          status: r.status,
          data: JSON.parse(r.data_json) as Step,
          video: r.video_id ? { id: r.video_id, start: r.start_seconds ?? 0, reason: r.video_reason, title: metas.get(r.video_id)?.title, channel: metas.get(r.video_id)?.channel } : null,
          backupsLeft: (JSON.parse(r.backups_json) as unknown[]).length,
        })),
    })),
  };
}
export type PathView = NonNullable<Awaited<ReturnType<typeof getPathView>>>;

export function listMyPaths() {
  return db
    .prepare(
      `SELECT p.id, p.skill, p.level, p.curated,
        ROUND(100.0 * SUM(s.status = 'passed') / COUNT(s.id)) AS progress
       FROM paths p JOIN steps s ON s.path_id = p.id
       WHERE p.started_at IS NOT NULL GROUP BY p.id ORDER BY p.started_at DESC`,
    )
    .all() as { id: number; skill: string; level: Level; curated: number; progress: number }[];
}

export function startPath(id: number) {
  db.prepare("UPDATE paths SET started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(id);
}

// ---------- video selection ----------

const PickSchema = z.object({
  videoId: z.string().nullable(), // null = no candidate actually teaches this step
  startSeconds: z.number(), // rounded before storing
  reason: z.string(),
  backups: z.array(z.object({ videoId: z.string(), startSeconds: z.number() })),
});

const stepKey = (skill: string, step: Step) => `${skill.toLowerCase()}|${step.title.toLowerCase()}`;

/** Hard filters, then the soft ≥5k-views filter (relaxed if it leaves fewer than 3). */
export function filterCandidates(metas: VideoMeta[], exclude: Set<string>): VideoMeta[] {
  const ok = metas.filter((m) => m.embeddable && m.privacy === "public" && m.durationSec >= 60 && m.durationSec <= 2400 && !exclude.has(m.id));
  const popular = ok.filter((m) => m.views >= 5000);
  return popular.length >= 3 ? popular : ok;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Prefixes the skill name when a query never mentions it ("one handed ball toss drill" found tennis videos for juggling). */
export function withSkill(query: string, skill: string): string {
  const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  const q = new Set(words(query));
  return words(skill).some((w) => q.has(w)) ? query : `${skill} ${query}`;
}

/** Shrinks a "[m:ss] ..." transcript to ~max chars by keeping evenly spaced lines, so the whole video stays covered. */
export function fitLines(text: string, max: number): string {
  if (text.length <= max) return text;
  const step = Math.ceil(text.length / max);
  return text.split("\n").filter((_, i) => i % step === 0).join("\n").slice(0, max); // slice: hard cap if lines are uneven
}

async function selectVideo(stepId: number) {
  const row = stepRow(stepId);
  const path = db.prepare("SELECT skill FROM paths WHERE id = ?").get(row.path_id) as { skill: string };
  const step = JSON.parse(row.data_json) as Step;
  const disliked = (db.prepare("SELECT video_id FROM video_ratings WHERE step_key = ? AND rating < 0").all(stepKey(path.skill, step)) as { video_id: string }[]).map((r) => r.video_id);
  const exclude = new Set([...disliked, ...(JSON.parse(row.seen_json) as string[])]);

  // Run queries one at a time and stop once we have enough candidates: each search costs 100 quota units.
  const ids: string[] = [];
  let candidates: VideoMeta[] = [];
  for (const q of step.searchQueries.slice(0, 3)) {
    for (const id of await searchIds(withSkill(q, path.skill))) if (!ids.includes(id)) ids.push(id);
    const metas = await getVideos(ids);
    candidates = filterCandidates(ids.flatMap((id) => metas.get(id) ?? []), exclude);
    if (candidates.length >= 5) break;
  }
  candidates = candidates.slice(0, 5); // keep search-relevance order
  if (!candidates.length) throw new Error(`No suitable videos found for "${step.title}".`);

  const transcripts = await Promise.all(candidates.map((c) => getTranscript(c.id, c.durationSec))); // parallel: each can take up to 10s
  const blocks = candidates.map((c, i) => {
    const transcript = transcripts[i];
    const ch = chapters(c.description);
    return `<candidate id="${c.id}">
title: ${c.title}
channel: ${c.channel}
duration: ${fmt(c.durationSec)} (${c.durationSec}s) · views: ${c.views} · likes: ${c.likes}
${ch.length ? `chapters:\n${ch.join("\n")}\n` : ""}${transcript ? `transcript${transcript.length > TRANSCRIPT_CHARS ? " (sampled)" : ""}:\n${fitLines(transcript, TRANSCRIPT_CHARS)}` : `no transcript available. description:\n${c.description.slice(0, 1500)}`}
</candidate>`;
  });
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const badStart = (id: string, s: number) => s < 0 || s >= byId.get(id)!.durationSec;

  const pick = await askJSON({
    schema: PickSchema,
    system: "You pick the single best instructional YouTube video for one step of a skill-learning path, using only the candidates provided.",
    effort: "medium",
    prompt: `Skill: ${path.skill}
Step: ${step.title} — ${step.why}
Correct form looks like: ${step.looksLike.join("; ")}
Drills: ${step.drills.map((d) => d.name).join("; ")}

${blocks.join("\n\n")}

Choose the best candidate for teaching THIS step.
- Strongly prefer videos that visually demonstrate the technique/drill over talking-head explanations; use transcript cues like "watch", "here's the drill", "let's get in the water".
- startSeconds = where the demonstration of this step begins (skip intros, sponsor reads, channel plugs). Use transcript timestamps or chapters. 0 only if the demo really starts immediately.
- videoId must be one of the candidate ids above, copied exactly. Never invent ids.
- A video about a different sport or activity (e.g. a tennis toss for juggling) does NOT count, however similar the motion. If no candidate actually teaches ${path.skill}, set videoId to null and backups to [].
- backups: the 2 next-best candidates (different ids) with their own startSeconds; only ones that also teach ${path.skill}.
- reason: one line on why this video wins for this step.`,
    check: (p) => {
      if (p.videoId === null) return p.backups.length ? "When videoId is null, backups must be []." : null;
      const ids = [p.videoId, ...p.backups.map((b) => b.videoId)];
      const unknown = ids.filter((id) => !byId.has(id));
      if (unknown.length) return `These ids are not in the candidate set: ${unknown.join(", ")}. Use only: ${[...byId.keys()].join(", ")}.`;
      if (new Set(ids).size !== ids.length) return "videoId and backups must all be different.";
      if (p.backups.length > Math.min(2, byId.size - 1)) return `Give at most ${Math.min(2, byId.size - 1)} backups.`;
      const bad = [{ videoId: p.videoId, startSeconds: p.startSeconds }, ...p.backups].filter((b) => badStart(b.videoId, b.startSeconds));
      return bad.length ? `startSeconds must be ≥0 and less than the video duration (bad: ${bad.map((b) => b.videoId).join(", ")}).` : null;
    },
  });

  if (pick.videoId === null) {
    // Exclude these so the next attempt reaches further down the search results instead of re-judging the same videos.
    const seenNow = [...(JSON.parse(row.seen_json) as string[]), ...candidates.map((c) => c.id)];
    db.prepare("UPDATE steps SET seen_json = ? WHERE id = ?").run(JSON.stringify(seenNow), stepId);
    throw new Error(`None of the videos found actually teach "${step.title}". Click "Find video" to search further.`);
  }
  const seen = [...(JSON.parse(row.seen_json) as string[]), pick.videoId];
  const backups = pick.backups.map((b) => ({ videoId: b.videoId, startSeconds: Math.round(b.startSeconds) }));
  db.prepare("UPDATE steps SET video_id = ?, start_seconds = ?, video_reason = ?, backups_json = ?, seen_json = ? WHERE id = ?").run(
    pick.videoId, Math.round(pick.startSeconds), pick.reason, JSON.stringify(backups), JSON.stringify(seen), stepId,
  );
}

const inflight = new Map<number, Promise<void>>();
/** Selects a video for the step if it has none. Deduplicates concurrent calls. */
export async function ensureVideo(stepId: number): Promise<void> {
  if (stepRow(stepId).video_id) return;
  if (!inflight.has(stepId)) inflight.set(stepId, selectVideo(stepId).finally(() => inflight.delete(stepId)));
  return inflight.get(stepId)!;
}

/** Next backup if any, else a fresh selection excluding every video already shown for this step. */
export async function swapVideo(stepId: number) {
  const row = stepRow(stepId);
  const backups = JSON.parse(row.backups_json) as { videoId: string; startSeconds: number }[];
  const next = backups.shift();
  if (next) {
    const seen = [...(JSON.parse(row.seen_json) as string[]), next.videoId];
    db.prepare("UPDATE steps SET video_id = ?, start_seconds = ?, video_reason = ?, backups_json = ?, seen_json = ? WHERE id = ?").run(
      next.videoId, next.startSeconds, "Backup pick", JSON.stringify(backups), JSON.stringify(seen), stepId,
    );
  } else {
    await selectVideo(stepId);
  }
}

export async function rateVideo(stepId: number, rating: 1 | -1) {
  const row = stepRow(stepId);
  if (!row.video_id) return;
  const { skill } = db.prepare("SELECT skill FROM paths WHERE id = ?").get(row.path_id) as { skill: string };
  db.prepare("INSERT OR REPLACE INTO video_ratings (step_key, video_id, rating) VALUES (?, ?, ?)").run(stepKey(skill, JSON.parse(row.data_json)), row.video_id, rating);
  if (rating < 0) await swapVideo(stepId);
}

/** Only the current (first unpassed) step can be passed: progression is strictly in order. */
export function passStep(stepId: number) {
  const row = stepRow(stepId);
  const current = stepsOf(row.path_id).find((r) => r.status !== "passed");
  if (current?.id !== stepId) throw new Error("Only the current step can be passed. Refresh the page.");
  db.prepare("UPDATE steps SET status = 'passed', passed_at = datetime('now') WHERE id = ?").run(stepId);
}

// ---------- re-plan ----------

export async function replan(pathId: number, direction: "harder" | "easier") {
  const path = db.prepare("SELECT * FROM paths WHERE id = ?").get(pathId) as PathRow | undefined;
  if (!path) throw new Error("Path not found.");
  const rows = stepsOf(pathId);
  const cur = rows.find((r) => r.status !== "passed");
  if (!cur) return;
  const passed = rows.filter((r) => r.status === "passed");
  const meta = JSON.parse(path.plan_json) as { stages: { name: string; goal: string }[] };
  const curStep = JSON.parse(cur.data_json) as Step;
  const remaining = rows.filter((r) => r.status !== "passed").map((r) => `- [${meta.stages[r.stage_idx].name}] ${(JSON.parse(r.data_json) as Step).title}`);

  const plan = await askJSON({
    schema: PlanSchema,
    system: COACH,
    effort: "medium",
    prompt: `A ${path.level} learner of "${path.skill}" is mid-path.
Already passed (keep, don't repeat): ${passed.map((r) => (JSON.parse(r.data_json) as Step).title).join("; ") || "nothing yet"}.
Current step: "${curStep.title}" (pass test: ${curStep.passTest}). The learner says it is TOO ${direction === "harder" ? "EASY" : "HARD"}.
Remaining plan was:
${remaining.join("\n")}

Rewrite the rest of the path starting from the current step, ${direction === "easier" ? "breaking the current step into smaller, more achievable progressions with easier pass tests" : "skipping or compressing what is too easy and moving on to more demanding work"}.
The first stage you return continues the current stage "${meta.stages[cur.stage_idx].name}"; name later stages as you see fit.
${planRules(path.skill)}`,
    check: (p) => (p.stages.length === 0 || p.stages[0].steps.length === 0 ? "First stage needs at least one step." : null),
  });

  db.transaction(() => {
    db.prepare("DELETE FROM steps WHERE path_id = ? AND status != 'passed'").run(pathId);
    const keptInStage = passed.filter((r) => r.stage_idx === cur.stage_idx).length;
    insertSteps(pathId, cur.stage_idx, plan.stages, keptInStage);
    const stages = [...meta.stages.slice(0, cur.stage_idx + 1), ...plan.stages.slice(1).map(({ name, goal }) => ({ name, goal }))];
    db.prepare("UPDATE paths SET plan_json = ? WHERE id = ?").run(JSON.stringify({ stages }), pathId);
  })();
}

// ---------- reliability ----------

/** Re-checks every stored video; swaps out deleted/private/non-embeddable ones. */
export async function verifyAllVideos(log = console.log) {
  const rows = db.prepare("SELECT id, video_id FROM steps WHERE video_id IS NOT NULL").all() as { id: number; video_id: string }[];
  const live = await getVideos(rows.map((r) => r.video_id), true);
  let bad = 0;
  for (const r of rows) {
    const m = live.get(r.video_id);
    const problem = !m ? "deleted" : m.privacy !== "public" ? m.privacy : !m.embeddable ? "not embeddable" : null;
    if (!problem) continue;
    bad++;
    log(`step ${r.id}: ${r.video_id} is ${problem} → swapping`);
    try {
      await swapVideo(r.id);
      // a backup may itself be dead; re-check once
      const now = stepRow(r.id).video_id!;
      const nm = (await getVideos([now], true)).get(now);
      if (!nm || !nm.embeddable || nm.privacy !== "public") await selectVideo(r.id);
    } catch (e) {
      log(`  swap failed: ${(e as Error).message}`);
    }
  }
  log(`Checked ${rows.length} videos, ${bad} flagged.`);
}
