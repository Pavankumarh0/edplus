import Link from 'next/link';
import type { Metadata } from 'next';
import { LoopPlayer } from '../components/LoopPlayer';

export const metadata: Metadata = {
  title: 'EduPlus AI — who needs help, and whether the help worked',
  description:
    'EduPlus AI scores every student against rules the department sets, then measures each intervention against the snapshot taken when it began.',
};

/** The three cases the product is judged on, with the real demo numbers. */
const CASES = [
  {
    name: 'Missing data',
    claim: 'A blank is not a zero.',
    body:
      'Fatima Khan has attendance and nothing else. The indicators nobody measured are dropped, the remaining weights are re-normalised, and she is marked insufficient data in slate — so she can never look safe because of a sheet that was never uploaded.',
    figure: '0.35',
    figureNote: 'confidence, 3 gaps named',
  },
  {
    name: 'Improvement',
    claim: 'The next upload delivers the verdict.',
    body:
      'Every intervention freezes the snapshot it began from, and April’s records are scored against that baseline. Ananya improved. Shaurya Verma got worse despite the same outreach, 83.6 to 97.9, and the dashboard says so.',
    figure: '100 → 36.7',
    figureNote: 'Ananya Reddy, Critical to Watch',
  },
  {
    name: 'Conflicting indicators',
    claim: 'One bad indicator is enough.',
    body:
      'Rohan Mehta attends 96% of classes, which is exactly the student an average protects. His score of 36.6 sits in Watch, and one indicator deep enough in the red raises the level anyway. Where the signals disagree, the conflict is named rather than averaged.',
    figure: 'Watch → At Risk',
    figureNote: 'Rohan Mehta, escalated',
  },
];

/** What a judge can actually open. */
const SURFACES = [
  {
    name: 'Faculty dashboard',
    body:
      'Upload a CSV, see the prioritised list, open a student, read the generated report, log what you did about it.',
    detail: 'Next.js · web',
  },
  {
    name: 'Planly',
    body:
      'The student’s own app. It reads their real record from the same database and plans two weeks of work they can actually finish.',
    detail: 'Flutter · Android',
  },
  {
    name: 'Parent calls',
    body:
      'A voice agent that rings a parent in Kannada, Telugu, Hindi or English, asks one question, and records what they said.',
    detail: 'Sarvam + telephony',
  },
  {
    name: 'Tool registry',
    body:
      'Every agent action is a declared tool with a Zod schema and an allow-list. The same registry is served over MCP.',
    detail: 'MCP · stdio',
  },
];

const FACTS = [
  { value: '4', label: 'weighted indicators' },
  { value: '298', label: 'unit tests, all passing' },
  { value: '0', label: 'scores decided by the model' },
];

export default function LandingPage() {
  return (
    <main className="bg-canvas text-ink min-h-dvh">
      {/* ── Masthead ──────────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-6 sm:px-8">
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="bg-ink text-canvas grid h-8 w-8 place-items-center rounded-[10px] text-[15px] font-bold">
            E
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.01em] whitespace-nowrap">
            EduPlus AI
          </span>
        </span>
        <nav className="flex shrink-0 items-center gap-1">
          <Link
            href="/login"
            className="hover:bg-surface rounded-[var(--radius-pill)] px-3 py-2 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 sm:px-4"
          >
            Sign in
          </Link>
          <Link
            href="/overview"
            className="bg-ink text-canvas hover:bg-ink/90 rounded-[var(--radius-pill)] px-3.5 py-2 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 sm:px-4"
          >
            <span className="sm:hidden">Dashboard</span>
            <span className="hidden sm:inline">Open the dashboard</span>
          </Link>
        </nav>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pt-8 pb-14 sm:px-8 sm:pt-14 sm:pb-20">
        <h1 className="max-w-[20ch] text-[clamp(2.3rem,8vw,4.5rem)] leading-[0.97] font-[680] tracking-[-0.035em]">
          Who needs help, and whether the help worked.
        </h1>

        <p className="text-ink-muted mt-6 max-w-[62ch] text-[clamp(1rem,2.4vw,1.2rem)] leading-[1.55]">
          A college already records attendance, marks and submissions in three places that
          nobody joins up. EduPlus AI joins them, scores every student against rules the
          department sets, and then measures each intervention against the snapshot taken
          when it began.
        </p>

        {/* The loop itself — a Remotion composition, played live. */}
        <figure className="mt-10 sm:mt-14">
          <div className="bg-ink shadow-raised overflow-hidden rounded-[var(--radius-hero)] p-2 sm:p-3">
            <div className="overflow-hidden rounded-[22px]">
              <LoopPlayer />
            </div>
          </div>
          <figcaption className="text-ink-faint mt-3 text-[13.5px]">
            One pass through the product, played live as a Remotion composition — every
            frame computed from the frame number, not a CSS loop.
          </figcaption>
        </figure>

        {/* Three figures, not three cards. */}
        <dl className="border-hairline mt-12 grid grid-cols-1 gap-y-7 border-t pt-8 sm:grid-cols-3 sm:gap-x-8">
          {FACTS.map((fact) => (
            <div key={fact.label}>
              <dt className="text-ink-muted text-[13.5px]">{fact.label}</dt>
              <dd className="mt-1 text-[clamp(2rem,5vw,2.6rem)] leading-none font-[640] tracking-[-0.02em] tabular-nums">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── The hard cases ────────────────────────────────────────────────── */}
      <section className="bg-surface border-hairline border-y">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <h2 className="max-w-[28ch] text-[clamp(1.6rem,4.5vw,2.4rem)] leading-[1.1] font-[650] tracking-[-0.025em]">
            The three students a dashboard usually gets wrong.
          </h2>

          <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-hairline)] md:grid-cols-3">
            {CASES.map((item) => (
              <article key={item.name} className="bg-surface flex flex-col p-6 sm:p-7">
                <h3 className="text-[15px] font-semibold">{item.name}</h3>
                <p className="mt-3 text-[clamp(1.15rem,2.6vw,1.4rem)] leading-[1.25] font-[600] tracking-[-0.015em]">
                  {item.claim}
                </p>
                <p className="text-ink-muted mt-3 flex-1 text-[14.5px] leading-[1.6]">
                  {item.body}
                </p>
                <p className="border-hairline mt-6 border-t pt-4">
                  <span className="block text-[22px] leading-none font-[640] tracking-[-0.02em] tabular-nums">
                    {item.figure}
                  </span>
                  <span className="text-ink-faint mt-1.5 block text-[13px]">
                    {item.figureNote}
                  </span>
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── How the score is made ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <h2 className="max-w-[26ch] text-[clamp(1.6rem,4.5vw,2.4rem)] leading-[1.1] font-[650] tracking-[-0.025em]">
              The model writes. It does not score.
            </h2>
            <div className="text-ink-muted mt-6 space-y-4 text-[15.5px] leading-[1.65]">
              <p>
                Risk is a pure function of the records and the rules: same input, same
                answer, every time. Claude is given the snapshot after it is computed and
                asked to explain it, draft a parent message, or suggest what to try — never
                to decide how serious it is.
              </p>
              <p>
                Thresholds, weights and the band cutoffs are editable in the dashboard,
                because a department that cannot change the rule will not trust the number.
                Change a threshold and every student is rescored against the same history.
              </p>
            </div>
            <Link
              href="/rules"
              className="bg-lime text-ink border-lime-edge/40 mt-7 inline-block rounded-[var(--radius-pill)] border px-5 py-2.5 text-[14.5px] font-semibold"
            >
              See the rules
            </Link>
          </div>

          {/* The actual defaults. Specific numbers beat a diagram. */}
          <div className="bg-surface border-hairline rounded-[var(--radius-card)] border p-6 sm:p-7">
            <p className="text-ink-muted text-[13.5px]">Shipped defaults</p>
            <table className="mt-4 w-full border-collapse text-left">
              <thead>
                <tr className="text-ink-faint text-[13px]">
                  <th scope="col" className="pb-2 font-medium">Indicator</th>
                  <th scope="col" className="pb-2 text-right font-medium">Target</th>
                  <th scope="col" className="pb-2 text-right font-medium">Critical</th>
                  <th scope="col" className="pb-2 text-right font-medium">Weight</th>
                </tr>
              </thead>
              <tbody className="text-[14.5px] tabular-nums">
                {[
                  ['Attendance', '90%', '40%', '35%'],
                  ['Assessments', '65%', '15%', '35%'],
                  ['Submissions', '95%', '30%', '20%'],
                  ['Trend', '0', '−12 pts', '10%'],
                ].map(([name, target, critical, weight]) => (
                  <tr key={name} className="border-hairline border-t">
                    <th scope="row" className="py-2.5 pr-3 font-normal">{name}</th>
                    <td className="py-2.5 text-right">{target}</td>
                    <td className="py-2.5 text-right">{critical}</td>
                    <td className="py-2.5 text-right">{weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-ink-faint mt-5 text-[13.5px] leading-[1.55]">
              Bands at 25, 45 and 70. Any single indicator at 85 or worse raises the level
              regardless of the average.
            </p>
          </div>
        </div>
      </section>

      {/* ── What there is to open ─────────────────────────────────────────── */}
      <section className="bg-surface border-hairline border-y">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <h2 className="max-w-[24ch] text-[clamp(1.6rem,4.5vw,2.4rem)] leading-[1.1] font-[650] tracking-[-0.025em]">
            Four surfaces, one database.
          </h2>
          <ul className="mt-10">
            {SURFACES.map((surface) => (
              <li
                key={surface.name}
                className="border-hairline grid grid-cols-1 gap-x-8 gap-y-2 border-t py-6 sm:grid-cols-[13rem_1fr_auto] sm:items-baseline"
              >
                <h3 className="text-[17px] font-semibold tracking-[-0.01em]">
                  {surface.name}
                </h3>
                <p className="text-ink-muted max-w-[58ch] text-[15px] leading-[1.6]">
                  {surface.body}
                </p>
                <p className="text-ink-faint font-mono text-[12.5px]">{surface.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Close ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="bg-ink text-canvas rounded-[var(--radius-hero)] px-6 py-12 sm:px-12 sm:py-16">
          <h2 className="max-w-[24ch] text-[clamp(1.7rem,5vw,2.8rem)] leading-[1.08] font-[660] tracking-[-0.03em]">
            Start with the list of students who need someone this week.
          </h2>
          <p className="mt-5 max-w-[56ch] text-[15.5px] leading-[1.6] opacity-75">
            The demo data is already loaded: 30 students, two months of records, and the
            three hard cases above.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/overview"
              className="bg-lime text-ink rounded-[var(--radius-pill)] px-5 py-3 text-[15px] font-semibold"
            >
              Open the dashboard
            </Link>
            <Link
              href="/login"
              className="border-canvas/30 hover:bg-canvas/10 rounded-[var(--radius-pill)] border px-5 py-3 text-[15px] font-medium transition-colors duration-150"
            >
              Sign in as faculty
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-hairline mx-auto max-w-6xl border-t px-5 py-8 sm:px-8">
        <p className="text-ink-faint text-[13.5px]">
          EduPlus AI — built for CBC 2.0, problem statement PS-055, by Team Tony Stark.
        </p>
      </footer>
    </main>
  );
}
