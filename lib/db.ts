import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "data");
fs.mkdirSync(dir, { recursive: true });

// ponytail: one module-level connection; Next dev HMR may open a second, which SQLite (WAL) handles fine.
export const db = new Database(path.join(dir, "getgoated.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS paths (
  id INTEGER PRIMARY KEY,
  skill TEXT NOT NULL,
  level TEXT NOT NULL,
  curated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  plan_json TEXT NOT NULL,
  UNIQUE (skill, level)
);
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- never reuse ids: a stale tab must not act on a step created by a re-plan
  path_id INTEGER NOT NULL REFERENCES paths(id) ON DELETE CASCADE,
  stage_idx INTEGER NOT NULL,
  step_idx INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  video_id TEXT,
  start_seconds INTEGER,
  video_reason TEXT,
  backups_json TEXT NOT NULL DEFAULT '[]',
  seen_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'todo',
  passed_at TEXT
);
CREATE TABLE IF NOT EXISTS video_ratings (
  step_key TEXT NOT NULL,
  video_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  PRIMARY KEY (step_key, video_id)
);
CREATE TABLE IF NOT EXISTS assessments (skill TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS yt_search_cache (query TEXT PRIMARY KEY, ids_json TEXT NOT NULL, fetched_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS yt_video_cache (id TEXT PRIMARY KEY, meta_json TEXT NOT NULL, transcript TEXT, fetched_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS quota_log (date TEXT PRIMARY KEY, units INTEGER NOT NULL DEFAULT 0);
`);

// One-time migration: DBs created before steps.id was AUTOINCREMENT.
const stepsSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'steps'").get() as { sql: string }).sql;
if (!stepsSql.includes("AUTOINCREMENT")) {
  db.transaction(() => {
    db.exec(`ALTER TABLE steps RENAME TO steps_old;
      ${stepsSql.replace("id INTEGER PRIMARY KEY,", "id INTEGER PRIMARY KEY AUTOINCREMENT,")};
      INSERT INTO steps SELECT * FROM steps_old;
      DROP TABLE steps_old;`);
  })();
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // YouTube quota resets at Pacific midnight

export function logQuota(units: number) {
  db.prepare("INSERT INTO quota_log (date, units) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET units = units + excluded.units").run(today(), units);
}

export function quotaToday(): number {
  return (db.prepare("SELECT units FROM quota_log WHERE date = ?").get(today()) as { units: number } | undefined)?.units ?? 0;
}
