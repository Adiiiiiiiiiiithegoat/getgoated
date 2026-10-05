"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as P from "@/lib/pipeline";

type Result = { error?: string };

// Server actions are callable with arbitrary arguments, so validate them; the path to refresh comes from the DB, not the client.
async function safe(fn: () => Promise<unknown>, pathId?: () => number): Promise<Result> {
  let id: number | undefined;
  try {
    id = pathId?.(); // resolve before fn: a re-plan inside fn may delete the step
    await fn();
    return {};
  } catch (e) {
    console.error(e);
    return { error: (e as Error).message };
  } finally {
    if (id) revalidatePath(`/path/${id}`);
  }
}

const int = (n: unknown) => {
  if (!Number.isSafeInteger(n)) throw new Error("Bad request.");
  return n as number;
};

export async function submitAssessment(skill: string, level: P.Level): Promise<Result> {
  let id = 0;
  const r = await safe(async () => {
    const name = P.canonicalSkill(String(skill).slice(0, 80));
    if (!name || !P.LEVELS.includes(level)) throw new Error("Bad request.");
    id = await P.getOrCreatePath(name, level);
    P.startPath(id);
  });
  if (r.error) return r;
  redirect(`/path/${id}`);
}

const ofStep = (stepId: number) => () => P.pathOfStep(int(stepId));

export const ensureVideo = async (stepId: number) => safe(() => P.ensureVideo(stepId), ofStep(stepId));
export const swapVideo = async (stepId: number) => safe(() => P.swapVideo(stepId), ofStep(stepId));
export const rateVideo = async (stepId: number, rating: 1 | -1) =>
  safe(async () => {
    if (rating !== 1 && rating !== -1) throw new Error("Bad request.");
    await P.rateVideo(stepId, rating);
  }, ofStep(stepId));
export const passStep = async (stepId: number) => safe(async () => P.passStep(stepId), ofStep(stepId));
export const replan = async (pathId: number, dir: "harder" | "easier") =>
  safe(async () => {
    if (dir !== "harder" && dir !== "easier") throw new Error("Bad request.");
    await P.replan(pathId, dir);
  }, () => int(pathId));
