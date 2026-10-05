import assert from "node:assert";
import { db, quotaToday } from "../lib/db";
import * as P from "../lib/pipeline";
import { getVideos } from "../lib/youtube";

const SKILL = "Juggling";
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
type Row = { id: number; path_id: number; stage_idx: number; step_idx: number; video_id: string | null; start_seconds: number | null; backups_json: string; seen_json: string; status: string };
const step = (id: number) => db.prepare("SELECT * FROM steps WHERE id = ?").get(id) as Row;
const steps = (pid: number) => db.prepare("SELECT * FROM steps WHERE path_id = ? ORDER BY stage_idx, step_idx").all(pid) as Row[];

async function checkVideo(id: number, label: string) {
  const s = step(id);
  assert.ok(s.video_id, `${label}: has video`);
  const m = (await getVideos([s.video_id!])).get(s.video_id!)!;
  assert.ok(m, `${label}: video exists in API cache`);
  assert.ok(Number.isInteger(s.start_seconds) && s.start_seconds! >= 0 && s.start_seconds! < m.durationSec, `${label}: start ${s.start_seconds} within ${m.durationSec}s`);
  assert.ok(m.embeddable && m.durationSec >= 60 && m.durationSec <= 2400, `${label}: passes filters`);
  log(`  ${label}: ${s.video_id} @${s.start_seconds}s "${m.title}" backups=${JSON.parse(s.backups_json).length}`);
}

function checkStructure(pid: number) {
  const { stages } = JSON.parse((db.prepare("SELECT plan_json FROM paths WHERE id = ?").get(pid) as { plan_json: string }).plan_json);
  const rows = steps(pid);
  const used = new Set(rows.map((r) => r.stage_idx));
  for (let i = 0; i < stages.length; i++) assert.ok(used.has(i), `stage ${i} (${stages[i].name}) has steps`);
  for (const r of rows) assert.ok(r.stage_idx < stages.length, `step ${r.id} stage_idx in range`);
  for (const si of used) {
    const idx = rows.filter((r) => r.stage_idx === si).map((r) => r.step_idx);
    assert.equal(new Set(idx).size, idx.length, `stage ${si}: unique step_idx`);
  }
  const firstOpen = rows.findIndex((r) => r.status !== "passed");
  assert.ok(rows.slice(0, firstOpen === -1 ? rows.length : firstOpen).every((r) => r.status === "passed") && rows.slice(firstOpen).every((r) => r.status !== "passed"), "passed steps are a prefix");
  return { stages, rows };
}

(async () => {
  const q0 = quotaToday();
  if (db.prepare("SELECT 1 FROM paths WHERE skill = ? COLLATE NOCASE AND started_at IS NOT NULL").get(SKILL)) throw new Error("You have a real Juggling path; not touching it.");
  db.prepare("DELETE FROM paths WHERE skill IN (?, 'GG Test Juggling') COLLATE NOCASE").run(SKILL);
  db.prepare("DELETE FROM assessments WHERE skill = ? COLLATE NOCASE").run(SKILL);

  log("1. assessment + case-insensitive cache");
  const a1 = await P.getAssessment(SKILL);
  const a2 = await P.getAssessment(SKILL.toUpperCase());
  assert.deepEqual(a1, a2);
  assert.ok(a1.questions.length >= 3 && a1.questions.length <= 4);

  log("2. plan + case-insensitive path");
  const pid = await P.getOrCreatePath(SKILL, "beginner");
  assert.equal(await P.getOrCreatePath(SKILL.toLowerCase(), "beginner"), pid);
  let { rows } = checkStructure(pid);
  log(`  ${rows.length} steps`);

  log("3. pass-order guard + stale id");
  assert.throws(() => P.passStep(rows[1].id), /Only the current step/);
  await assert.rejects(P.swapVideo(99999999), /no longer exists/);

  log("4. pick video (concurrent calls deduped)");
  const s1 = rows[0].id;
  await Promise.all([P.ensureVideo(s1), P.ensureVideo(s1)]);
  await checkVideo(s1, "pick");
  const first = step(s1).video_id!;

  log("5. swap through backups, then a fresh selection");
  const shown = new Set([first]);
  for (let i = 0; i < 3; i++) {
    const before = step(s1);
    const hadBackups = JSON.parse(before.backups_json).length;
    await P.swapVideo(s1);
    const after = step(s1);
    await checkVideo(s1, `swap ${i + 1} (${hadBackups ? "backup" : "fresh"})`);
    assert.ok(!shown.has(after.video_id!), "swap never repeats a shown video");
    shown.add(after.video_id!);
  }

  log("6. thumbs down excludes + swaps");
  const bad = step(s1).video_id!;
  await P.rateVideo(s1, -1);
  assert.notEqual(step(s1).video_id, bad);
  const r = db.prepare("SELECT rating FROM video_ratings WHERE video_id = ?").get(bad) as { rating: number };
  assert.equal(r.rating, -1);
  await checkVideo(s1, "after 👎");

  log("7. pass step 1");
  P.passStep(s1);
  const view = (await P.getPathView(pid))!;
  assert.equal(view.currentId, rows[1].id);
  assert.ok(view.progress > 0);

  log("8. replan easier (keeps passed)");
  await P.replan(pid, "easier");
  ({ rows } = checkStructure(pid));
  assert.equal(rows[0].id, s1, "passed step kept");
  assert.equal(rows[0].status, "passed");
  log(`  now ${rows.length} steps`);

  log("9. old step ids are gone → clear error");
  assert.throws(() => P.pathOfStep(view.stages.flatMap((s) => s.steps)[1].id), /no longer exists/);

  log("10. replan harder");
  await P.replan(pid, "harder");
  ({ rows } = checkStructure(pid));
  log(`  now ${rows.length} steps`);

  log("11. verify-videos");
  await P.verifyAllVideos((m) => log("  " + m));

  log(`quota used by test: ${quotaToday() - q0} units`);
  db.prepare("DELETE FROM paths WHERE id = ?").run(pid);
  db.prepare("DELETE FROM assessments WHERE skill = ? COLLATE NOCASE").run(SKILL);
  log("ALL E2E CHECKS PASSED (test path deleted)");
})().catch((e) => {
  console.error("E2E FAIL:", e);
  process.exit(1);
});
