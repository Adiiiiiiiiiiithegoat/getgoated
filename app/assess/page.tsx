import Link from "next/link";
import { canonicalSkill, CURATED, getAssessment } from "@/lib/pipeline";
import Quiz from "./Quiz";

export default async function AssessPage({ searchParams }: PageProps<"/assess">) {
  const raw = (await searchParams).skill;
  const skill = canonicalSkill(typeof raw === "string" ? raw.slice(0, 80) : "");
  if (!skill) return <Link href="/">← Pick a skill first</Link>;
  const a = await getAssessment(skill).catch((e: Error) => e);
  if (a instanceof Error) return <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">Couldn&apos;t build the assessment: {a.message}</p>;
  return <Quiz skill={skill} curated={CURATED.some((c) => c.name === skill)} questions={a.questions} />;
}
