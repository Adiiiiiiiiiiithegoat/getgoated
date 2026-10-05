// Client-safe (no DB imports): used by both the quiz UI and the pipeline.
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

/** Conservative placement: floor of the average answer level. */
export function placeLevel(answers: Level[]): Level {
  const avg = answers.reduce((s, l) => s + LEVELS.indexOf(l), 0) / Math.max(answers.length, 1);
  return LEVELS[Math.floor(avg)];
}
