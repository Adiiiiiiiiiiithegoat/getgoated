import Link from "next/link";
import { CURATED, listMyPaths } from "@/lib/pipeline";

const ICON: Record<string, string> = { "Freestyle swimming": "🏊", "8-ball pool": "🎱", Basketball: "🏀" };
const assess = (skill: string) => `/assess?skill=${encodeURIComponent(skill)}`;

export default function Home() {
  const mine = listMyPaths();
  const lifts = CURATED.filter((c) => c.group === "Gym");
  return (
    <div className="space-y-10">
      <section className="lanes -mx-4 rounded-none px-4 py-8 sm:mx-0 sm:rounded-2xl sm:border sm:border-line">
        <h1 className="font-display text-5xl leading-none font-extrabold uppercase italic sm:text-6xl">
          Pick a skill.
          <br />
          <span className="text-volt">Earn every level.</span>
        </h1>
        <p className="mt-3 max-w-md text-sm text-muted">Staged drills, pass tests, and real coaching videos that jump straight to the demo.</p>
        <form action="/assess" className="mt-6 flex gap-2">
          <input
            name="skill"
            required
            placeholder="e.g. freestyle swimming, juggling, kickflip…"
            className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-4 text-lg outline-none placeholder:text-muted/70 focus:border-volt"
          />
          <button className="rounded-xl bg-volt px-5 font-display text-xl font-extrabold text-ink uppercase">Go</button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 font-display text-xl font-semibold tracking-wide text-muted uppercase">Launch skills</h2>
        <div className="grid grid-cols-2 gap-3">
          {CURATED.filter((c) => !c.group).map((c) => (
            <Link key={c.name} href={assess(c.name)} className="group rounded-2xl border border-line bg-panel p-4 transition hover:border-volt">
              <div className="text-3xl">{ICON[c.name]}</div>
              <div className="mt-6 font-display text-2xl leading-tight font-extrabold uppercase group-hover:text-volt">{c.name}</div>
            </Link>
          ))}
          <details className="group/gym rounded-2xl border border-line bg-panel p-4 open:col-span-2 open:border-volt">
            <summary className="cursor-pointer list-none">
              <div className="text-3xl">🏋️</div>
              <div className="mt-6 font-display text-2xl font-extrabold uppercase">
                Gym <span className="text-sm font-semibold text-muted group-open/gym:hidden">· 4 lifts</span>
              </div>
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {lifts.map((l) => (
                <Link key={l.name} href={assess(l.name)} className="rounded-xl border border-line px-3 py-3 font-display text-lg font-semibold uppercase hover:border-volt hover:text-volt">
                  {l.name}
                </Link>
              ))}
            </div>
          </details>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-xl font-semibold tracking-wide text-muted uppercase">My paths</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Pick a skill above.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((p) => (
              <li key={p.id}>
                <Link href={`/path/${p.id}`} className="block rounded-xl border border-line bg-panel p-4 hover:border-volt">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display text-xl font-extrabold uppercase">{p.skill}</span>
                    <span className="font-display text-xl font-extrabold text-volt">{p.progress}%</span>
                  </div>
                  <div className="mt-1 text-xs text-muted capitalize">
                    {p.level}
                    {!p.curated && " · uncurated"}
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-volt" style={{ width: `${p.progress}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
