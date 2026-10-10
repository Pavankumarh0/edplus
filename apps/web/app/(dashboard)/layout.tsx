import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/Sidebar';
import { Copilot } from '@/components/Copilot';

/**
 * Auth gate for every dashboard route.
 *
 * Checked in a layout rather than middleware because verifying a session
 * cookie needs the Admin SDK, which cannot run in the Edge runtime. One check
 * here covers every page beneath it.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) redirect('/login');

  if (session.role !== 'faculty') {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="max-w-[46ch] text-center">
          <h1 className="text-h1">This dashboard is for faculty</h1>
          <p className="text-body text-ink-muted mt-3">
            You are signed in as{' '}
            <span className="font-medium">{session.email ?? session.uid}</span>
            {session.role === 'student'
              ? '. Students use the EduPlus mobile app.'
              : ', and your account has no role assigned yet.'}
          </p>
          <form action="/api/session/logout" method="post" className="mt-6">
            <button
              type="submit"
              className="bg-ink text-canvas text-body min-h-[40px] rounded-[var(--radius-control)] px-4 font-medium"
            >
              Sign out
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <Sidebar userLabel={session.name ?? session.email ?? 'Signed in'} />
      {/* Bottom padding on mobile clears the nav bar; left margin clears the rail. */}
      <main className="px-4 pb-24 pt-6 md:ml-[72px] md:px-8 md:pb-10">
        <div className="mx-auto max-w-[1440px]">{children}</div>
      </main>
      {/* Available on every dashboard page, per the brief. */}
      <Copilot />
    </div>
  );
}
