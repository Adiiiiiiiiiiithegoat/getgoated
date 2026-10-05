import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";
import { db, logQuota } from "./db";

export type VideoMeta = {
  id: string;
  title: string;
  channel: string;
  description: string;
  durationSec: number;
  views: number;
  likes: number;
  embeddable: boolean;
  privacy: string;
};

export class QuotaError extends Error {
  constructor() {
    super("YouTube API daily quota is used up (resets at midnight Pacific). Showing cached data only.");
  }
}

async function yt(endpoint: string, params: Record<string, string>, units: number) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set in .env.local");
  const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams({ ...params, key })}`;
  const res = await fetch(url);
  logQuota(units); // YouTube charges failed calls too
  const body = await res.json().catch(() => null); // 5xx pages can be HTML
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") throw new QuotaError();
    throw new Error(`YouTube ${endpoint} failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
  }
  return body;
}

/** search.list (100 units), cached forever by query. */
export async function searchIds(query: string): Promise<string[]> {
  const hit = db.prepare("SELECT ids_json FROM yt_search_cache WHERE query = ?").get(query) as { ids_json: string } | undefined;
  if (hit) return JSON.parse(hit.ids_json);
  const body = await yt("search", {
    part: "id", q: query, type: "video", videoEmbeddable: "true", relevanceLanguage: "en", maxResults: "8", safeSearch: "strict",
  }, 100);
  const ids: string[] = body.items.map((i: { id: { videoId: string } }) => i.id.videoId).filter(Boolean);
  db.prepare("INSERT OR REPLACE INTO yt_search_cache (query, ids_json) VALUES (?, ?)").run(query, JSON.stringify(ids));
  return ids;
}

export function parseDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

/** videos.list (1 unit per 50 ids). Cached; `fresh` bypasses the cache (used by verify-videos). Deleted videos are simply absent. */
export async function getVideos(ids: string[], fresh = false): Promise<Map<string, VideoMeta>> {
  const out = new Map<string, VideoMeta>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = !fresh && (db.prepare("SELECT meta_json FROM yt_video_cache WHERE id = ?").get(id) as { meta_json: string } | undefined);
    if (hit) out.set(id, JSON.parse(hit.meta_json));
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 50) {
    const body = await yt("videos", { part: "snippet,contentDetails,statistics,status", id: missing.slice(i, i + 50).join(",") }, 1);
    for (const v of body.items) {
      const meta: VideoMeta = {
        id: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        description: v.snippet.description ?? "",
        durationSec: parseDuration(v.contentDetails.duration),
        views: Number(v.statistics.viewCount ?? 0),
        likes: Number(v.statistics.likeCount ?? 0),
        embeddable: !!v.status.embeddable,
        privacy: v.status.privacyStatus,
      };
      db.prepare("INSERT INTO yt_video_cache (id, meta_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET meta_json = excluded.meta_json, fetched_at = datetime('now')").run(v.id, JSON.stringify(meta));
      out.set(v.id, meta);
    }
  }
  return out;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Errors meaning "this video has no usable English captions": safe to cache as a miss. Anything else (timeout, rate limit) is retried next time.
const PERMANENT = [YoutubeTranscriptDisabledError, YoutubeTranscriptNotAvailableError, YoutubeTranscriptNotAvailableLanguageError, YoutubeTranscriptVideoUnavailableError];

/** Timestamped transcript as "[m:ss] text" lines in ~15s blocks, or null. Cached (permanent misses as ''). */
export async function getTranscript(id: string, durationSec: number): Promise<string | null> {
  const row = db.prepare("SELECT transcript FROM yt_video_cache WHERE id = ?").get(id) as { transcript: string | null } | undefined;
  if (row?.transcript != null) return row.transcript || null;
  let text = "";
  let timer: NodeJS.Timeout | undefined;
  try {
    const segs = await Promise.race([
      YoutubeTranscript.fetchTranscript(id, { lang: "en" }),
      new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("timeout")), 10_000))),
    ]);
    // The library returns ms for one caption format and seconds for the other.
    const last = segs.at(-1)?.offset ?? 0;
    const div = durationSec > 0 && last > durationSec * 1.5 ? 1000 : 1;
    const lines: string[] = [];
    let blockStart = -Infinity;
    for (const s of segs) {
      const t = s.offset / div;
      if (t - blockStart >= 15) { lines.push(`[${fmt(t)}]`); blockStart = t; }
      lines[lines.length - 1] += " " + s.text.replace(/\s+/g, " ");
    }
    text = lines.join("\n");
  } catch (e) {
    // flaky scraper / no captions → caller falls back to metadata
    if (!PERMANENT.some((E) => e instanceof E)) return null;
  } finally {
    clearTimeout(timer);
  }
  db.prepare("UPDATE yt_video_cache SET transcript = ? WHERE id = ?").run(text, id);
  return text || null;
}

/** "0:00 Intro" style chapter lines from the description. */
export function chapters(description: string): string[] {
  return description.split("\n").filter((l) => /^\s*\(?\d{1,2}:\d{2}(:\d{2})?\)?\s+\S/.test(l)).map((l) => l.trim());
}
