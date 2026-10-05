# GetGoated

Local, single-user web app: type a physical skill, answer 3–4 placement questions, get a staged path (Foundation → Core → Advanced) where every step has drills, form cues, a measurable pass test, and a real YouTube demo that starts at the right timestamp.

**The LLM never writes a URL or video ID.** It writes search queries, then picks from IDs the YouTube Data API returned. Code rejects any ID outside that candidate set (and any `startSeconds` past the video's end) and retries.

## Setup (Windows 11)

Node 20+ required.

```
npm install
copy .env.example .env.local
```

Fill in `.env.local`:

| Var | Where to get it |
|---|---|
| `GROQ_API_KEY` | console.groq.com → **API Keys**. If set, Groq is used (default model `openai/gpt-oss-120b`). |
| `ANTHROPIC_API_KEY` | console.anthropic.com → **API Keys**. Used when `GROQ_API_KEY` is empty. |
| `YOUTUBE_API_KEY` | console.cloud.google.com → create a project → **APIs & Services → Library** → enable **YouTube Data API v3** → **Credentials → Create credentials → API key**. Restrict it to YouTube Data API v3. |
| `GG_MODEL` | optional override; defaults to `openai/gpt-oss-120b` (Groq) or `claude-sonnet-5-5` (Anthropic) |

```
npm run dev        # http://localhost:3000
```

## Seeding the launch skills

```
npm run seed                                   # all 7 curated skills × 3 levels
npm run seed -- "Freestyle swimming" beginner  # one path + a review report of every chosen video
```

**Quota:** YouTube gives 10,000 units/day; a search costs 100. Each step uses 1–3 searches (it stops early once it has 5 good candidates), so one path costs roughly 1,000–2,500 units and the full seed (21 paths) takes **2–4 days of quota**. The seed is resumable: when quota runs out it stops cleanly, and the next run resumes from where it stopped. Paths load instantly once seeded; any step still missing a video gets one the first time you open it.

Today's usage is shown in the footer (`quota_log` table; resets at midnight Pacific).

## Other scripts

```
npm run verify-videos   # re-check every stored video; swap deleted / private / non-embeddable ones
npm run check           # offline self-check of the pure logic (filters, placement, parsing)
```

## Data

Everything lives in `data/getgoated.db` (SQLite). Delete it to start over. Tables: `paths`, `steps`, `video_ratings`, `assessments`, `yt_search_cache`, `yt_video_cache` (metadata + transcript), `quota_log`.

## Code map

- `lib/youtube.ts`: search.list / videos.list / transcripts, all cached; quota logging
- `lib/llm.ts`: `askJSON` (Groq or Anthropic), JSON-schema output + zod validation + retry with the error
- `lib/pipeline.ts`: curated outlines, assessment, plan, video picker, swap/rate/re-plan, verify
- `app/`: home, `/assess`, `/path/[id]`, plus server actions in `app/actions.ts` (keys never reach the browser)
