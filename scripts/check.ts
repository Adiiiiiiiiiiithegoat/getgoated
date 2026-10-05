// Offline self-check for the pure logic: `npx tsx scripts/check.ts`
import assert from "node:assert";
import { parseDuration, chapters } from "../lib/youtube";
import { placeLevel, filterCandidates, canonicalSkill, fitLines } from "../lib/pipeline";
import type { VideoMeta } from "../lib/youtube";

assert.equal(parseDuration("PT1H2M3S"), 3723);
assert.equal(parseDuration("PT45S"), 45);
assert.equal(parseDuration("P0D"), 0);
assert.deepEqual(chapters("Intro\n0:00 Intro\n1:23 Kick drill\nfoo 2:00"), ["0:00 Intro", "1:23 Kick drill"]);

assert.equal(placeLevel(["beginner", "advanced", "intermediate"]), "intermediate");
assert.equal(placeLevel(["beginner", "intermediate", "intermediate"]), "beginner");
assert.equal(placeLevel(["advanced", "advanced", "advanced"]), "advanced");

assert.equal(canonicalSkill("  swimming "), "Freestyle swimming");
assert.equal(canonicalSkill("bench press"), "Bench press");
assert.equal(canonicalSkill("Juggling"), "Juggling");

const v = (id: string, durationSec: number, views: number, embeddable = true): VideoMeta =>
  ({ id, title: id, channel: "", description: "", durationSec, views, likes: 0, embeddable, privacy: "public" });
const vids = [v("short", 30, 1e6), v("long", 3000, 1e6), v("noembed", 300, 1e6, false), v("a", 300, 10), v("b", 300, 9000), v("c", 300, 9000), v("d", 300, 9000)];
assert.deepEqual(filterCandidates(vids, new Set()).map((m) => m.id), ["b", "c", "d"]);
assert.deepEqual(filterCandidates(vids, new Set(["d"])).map((m) => m.id), ["a", "b", "c"]); // soft view filter relaxed
const tr = Array.from({ length: 100 }, (_, i) => `[${i}:00] words words words`).join("\n");
const fitted = fitLines(tr, 600);
assert.ok(fitted.length <= 700 && fitted.startsWith("[0:00]") && fitted.includes("[95:00]")); // spans the whole video
assert.equal(fitLines("short", 600), "short");
console.log("all checks passed");
