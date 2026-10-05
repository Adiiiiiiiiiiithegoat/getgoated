# Build GetGoated — v1

## What it is
GetGoated is a personal, local-only web app. I type a physical skill (e.g. "freestyle swimming"). It asks me a few quick questions to gauge my level. Then it gives me a staged, step-by-step improvement path. Every step has a real, verified YouTube video that starts at the exact timestamp where the technique is demonstrated.

It must beat ChatGPT/Claude at this job on two specific points:
1. **No fake or broken video links, ever.**
2. **Clear progression:** an ordered path with tests to pass before moving on, not a list of tips.

## Hard constraints
- **Single user (me), runs locally.** No auth, no accounts, no cloud database, no deployment in v1. Must run on Windows 11 with `npm run dev`.
- **All persistent data goes in one local SQLite file** (`data/getgoated.db`): paths, progress, video ratings, caches.
- **THE LLM NEVER WRITES A URL OR VIDEO ID.**
  - The LLM only writes YouTube *search queries*, and later chooses among candidate video IDs that the YouTube API returned.
  - Every URL is built in code from an ID the YouTube Data API returned.
  - Enforce this in code: if a chosen ID is not in the candidate set, reject it and retry.

## Stack
- Next.js (App Router) + TypeScript + Tailwind
- `better-sqlite3` for storage
- `@anthropic-ai/sdk`
  - Model comes from env `GG_MODEL`, default `claude-sonnet-5-5`.
  - Use tool use / JSON output, validated with `zod`.
- YouTube Data API v3 (`search.list`, `videos.list`)
- Transcripts: a transcript-fetching package such as `youtube-transcript`.
  - It is flaky, so wrap it with a timeout.
  - Fall back to title + description + chapters when no transcript is available.
- `.env.local`: `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, `GG_MODEL`
  - Also create a `.env.example`.

## Core pipeline
1. **Assessment**
   - Given a skill, the LLM generates 3–4 multiple-choice questions to place me at a level: beginner / intermediate / advanced.
   - The questions must be concrete, e.g. "Can you swim 25 m freestyle without stopping?"
2. **Plan**
   - The LLM returns a structured path (validate with zod): Stages (Foundation → Core → Advanced, starting at my level) → Steps.
   - Each step has:
     - `title`
     - `why` (1 line)
     - `drills[]`: name, sets/reps/duration
     - `looksLike[]`: correct-form cues
     - `commonMistakes[]`
     - `passTest`: concrete and measurable, e.g. "8/10 straight-in stop shots"
     - `estimatedSessions`
     - `safetyNote` (optional)
     - `searchQueries[]`: 2–3 queries
3. **Video selection, per step**
   - Run the queries through `search.list` with `type=video`, `videoEmbeddable=true`, `relevanceLanguage=en`, `maxResults≈8`. Dedupe the results.
   - Call `videos.list` on the candidates to get duration, view count, like count and embeddable status.
   - Drop any video that is:
     - under 60 s,
     - over 40 min, or
     - under 5k views (soft filter: relax it if too few candidates are left).
   - Fetch transcripts for the top ~5 candidates.
   - The LLM picks the best video **from the candidate IDs only**. It returns:
     - `videoId`
     - `startSeconds`: where the *demonstration* of this step begins, not the intro
     - a 1-line reason
     - a `backupVideoIds[]` list (2 alternates)
   - Prefer videos that *show* the technique over talking-head explanations.
   - Validate:
     - the returned ID is in the candidate set;
     - `startSeconds` is less than the video's duration.
4. **Cache everything**
   - Search results, video metadata and transcripts, keyed by query or ID.
   - Generated paths, keyed by skill + level.
   - Log YouTube quota units used per day (search = 100 units, videos.list = 1). Show today's usage in a small footer.

## Launch skills (curated)
Seed these 4 with a script (`npm run seed`) that pre-generates each at all 3 levels, so they load instantly. Use these outlines as guidance in the plan prompt for each skill:

- **Swimming (freestyle):** body position/floating → kick → breathing (incl. bilateral) → arm stroke/catch → full stroke + endurance
  - Example test: "25 m bilateral breathing without stopping"
- **8-ball pool:** stance, bridge, straight stroke → aiming → cue-ball control (stop, stun, draw, follow) → position play → safety play & break
  - Example test: "8/10 straight-in stop shots"
- **Basketball:** shooting form → free throws → ball handling (both hands) → layups (both sides) → shooting off the dribble
  - Example tests: "7/10 free throws", "10 weak-hand layups in a row"
- **Gym:** four separate sub-paths: squat, bench press, deadlift, pull-ups. Each goes form → technique cues → progression plan.
  - Every lifting step needs a safety note: warm-up, a load increase rule, and stop if there is sharp pain.
  - Pull-ups start from dead hangs / negatives if needed.

Any other skill typed into search still works, through the same pipeline with no curation. Show an "uncurated" badge on those.

## UI
- **Home**
  - Big search bar.
  - 4 launch-skill cards (gym expands into its 4 lifts).
  - A "My paths" list with a progress % on each.
- **Assessment screen:** one question at a time, quick taps.
- **Path screen**
  - Stages shown as a vertical progression.
  - The current step is expanded. Later steps are visible but dimmed.
  - In each step:
    - an embedded YouTube player that starts at `startSeconds` (`youtube-nocookie.com/embed/{id}?start=`)
    - drills
    - "Looks like" / "Common mistakes" boxes
    - safety note
    - pass test with a "Passed ✓" button
  - Buttons:
    - **Swap video:** cycles through the backups. If none are left, re-runs selection excluding rejected IDs.
    - **👍 / 👎 on the video:** stored. A 👎 auto-swaps, and that ID is excluded for this step in the future.
    - **Too hard / Too easy:** re-plans the rest of the path from the current step, keeping completed progress.
- Mobile-friendly layout, dark mode, a clean "athletic" look. Avoid looking like a generic template.

## Data model (suggested)
- `paths` (id, skill, level, curated, created_at, plan_json)
- `steps` (id, path_id, stage_idx, step_idx, data_json, video_id, start_seconds, backups_json, status, passed_at)
- `video_ratings` (step_key, video_id, rating)
- `yt_search_cache`
- `yt_video_cache` (metadata + transcript)
- `quota_log` (date, units)

## Reliability
- Script `npm run verify-videos`: calls `videos.list` on every stored video ID and flags or auto-swaps any that are deleted, private or non-embeddable.
- Graceful errors everywhere:
  - quota exhausted → serve from cache and show a clear message;
  - transcript missing → fall back to metadata;
  - LLM JSON invalid → retry once with the zod error, then fail clearly.
- Keep API keys server-side only, in route handlers / server actions.

## Build order — confirm each works before moving on
1. Scaffold, env, SQLite schema, quota logger
2. YouTube search + videos.list + caching (test with one query)
3. Transcript fetch + LLM video picker with ID validation
4. Assessment + plan generation (zod-validated)
5. Path UI with player, progress, swap / rate / re-plan
6. Seed script for the 4 launch skills; verify-videos script
7. README: setup, getting the two API keys, running seed

## Out of scope for v1 (keep the code ready for it)
- Upload a clip of myself for AI form feedback (v2)
- Accounts, deployment, multi-user

When done, run the seed for swimming at beginner level. Then show me the path it generated: each step's chosen video title, channel, start time and the picker's reason, so I can sanity-check video quality.
