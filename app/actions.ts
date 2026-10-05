"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as P from "@/lib/pipeline";

type Result = { error?: string };

async function safe(fn: () => Promise<unknown>, pathId?: number): Promise<Result> {
  try {
    await fn();
    return {};
  } catch (e) {
    console.error(e);
    return { error: (e as Error).message };
  } finally {
    if (pathId) revalidatePath(`/path/${pathId}`);
  }
}

export async function submitAssessment(skill: string, level: P.Level): Promise<Result> {
  let id = 0;
  const r = await safe(async () => {
    id = await P.getOrCreatePath(P.canonicalSkill(skill), level);
    P.startPath(id);
  });
  if (r.error) return r;
  redirect(`/path/${id}`);
}

export const ensureVideo = async (pathId: number, stepId: number) => safe(() => P.ensureVideo(stepId), pathId);
export const swapVideo = async (pathId: number, stepId: number) => safe(() => P.swapVideo(stepId), pathId);
export const rateVideo = async (pathId: number, stepId: number, rating: 1 | -1) => safe(() => P.rateVideo(stepId, rating), pathId);
export const passStep = async (pathId: number, stepId: number) => safe(async () => P.passStep(stepId), pathId);
export const replan = async (pathId: number, dir: "harder" | "easier") => safe(() => P.replan(pathId, dir), pathId);
