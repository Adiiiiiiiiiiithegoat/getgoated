import { notFound } from "next/navigation";
import { ensureVideo, getPathView, startPath } from "@/lib/pipeline";
import PathClient from "./PathClient";

export default async function PathPage({ params }: PageProps<"/path/[id]">) {
  const id = Number((await params).id);
  let view = Number.isInteger(id) ? await getPathView(id) : null;
  if (!view) notFound();
  startPath(id);
  // Pick a video for the current step on first view (uncurated skills, or the seed ran out of quota).
  let videoError: string | undefined;
  const current = view.stages.flatMap((s) => s.steps).find((s) => s.id === view!.currentId);
  if (current && !current.video) {
    try {
      await ensureVideo(current.id);
      view = (await getPathView(id))!;
    } catch (e) {
      videoError = (e as Error).message;
    }
  }
  return <PathClient view={view} videoError={videoError} />;
}
