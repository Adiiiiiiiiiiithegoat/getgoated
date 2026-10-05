// npm run seed                          → all curated skills × all levels
// npm run seed -- "Freestyle swimming" beginner   → just that one (prints a review report)
import { db } from "../lib/db";
import { CURATED, LEVELS, canonicalSkill, ensureVideo, getAssessment, getOrCreatePath, type Level, type Step } from "../lib/pipeline";
import { getVideos, QuotaError } from "../lib/youtube";

const [skillArg, levelArg] = process.argv.slice(2);
const skills = skillArg ? [canonicalSkill(skillArg)] : CURATED.map((c) => c.name);
const levels = (levelArg ? [levelArg] : LEVELS) as Level[];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

async function main() {
  for (const skill of skills) {
    await getAssessment(skill);
    for (const level of levels) {
      const t = Date.now();
      const id = await getOrCreatePath(skill, level);
      const steps = db.prepare("SELECT id, data_json, video_id FROM steps WHERE path_id = ? ORDER BY stage_idx, step_idx").all(id) as { id: number; data_json: string; video_id: string | null }[];
      console.log(`▶ ${skill} / ${level}: path ${id}, ${steps.length} steps`);
      for (const s of steps) {
        if (s.video_id) continue;
        try {
          await ensureVideo(s.id);
        } catch (e) {
          if (e instanceof QuotaError) throw e;
          console.log(`  ✗ ${(JSON.parse(s.data_json) as Step).title}: ${(e as Error).message}`);
        }
      }
      console.log(`  done in ${Math.round((Date.now() - t) / 1000)}s`);
      if (skillArg) await report(id);
    }
  }
}

async function report(pathId: number) {
  const rows = db.prepare("SELECT * FROM steps WHERE path_id = ? ORDER BY stage_idx, step_idx").all(pathId) as { stage_idx: number; data_json: string; video_id: string | null; start_seconds: number; video_reason: string; backups_json: string }[];
  const { stages } = JSON.parse((db.prepare("SELECT plan_json FROM paths WHERE id = ?").get(pathId) as { plan_json: string }).plan_json);
  const metas = await getVideos(rows.flatMap((r) => r.video_id ?? []));
  let lastStage = -1;
  for (const r of rows) {
    if (r.stage_idx !== lastStage) console.log(`\n=== Stage ${r.stage_idx + 1}: ${stages[r.stage_idx].name} ===`);
    lastStage = r.stage_idx;
    const step = JSON.parse(r.data_json) as Step;
    const m = r.video_id ? metas.get(r.video_id) : undefined;
    console.log(`\n• ${step.title}  [pass: ${step.passTest}]`);
    console.log(m ? `  ${m.title} — ${m.channel} — start ${fmt(r.start_seconds)} / ${fmt(m.durationSec)} — ${m.views.toLocaleString()} views\n  https://youtu.be/${r.video_id}?t=${r.start_seconds}\n  why: ${r.video_reason}\n  backups: ${JSON.parse(r.backups_json).length}` : "  (no video)");
  }
}

main().catch((e) => {
  console.error(e instanceof QuotaError ? `\n⏸  ${e.message}\nRe-run \`npm run seed\` after the reset; it resumes where it stopped.` : e);
  process.exit(1);
});
