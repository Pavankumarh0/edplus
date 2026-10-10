'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { describeAuthError, signInWithGoogle, signInWithPassword } from '@/lib/firebase-client';
import { Button } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'password' | 'google' | null>(null);

  async function run(kind: 'password' | 'google') {
    setError(null);
    setBusy(kind);
    try {
      if (kind === 'password') await signInWithPassword(email, password);
      else await signInWithGoogle();
      router.replace('/overview');
      router.refresh();
    } catch (caught) {
      setError(describeAuthError(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        {/* The hero is the product's actual claim, not a logo. */}
        <div className="mb-8">
          <span className="bg-ink text-canvas inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] text-[16px] font-bold">
            E
          </span>
          <h1 className="text-h1 mt-5">EduPlus AI</h1>
          <p className="text-body text-ink-muted mt-2 max-w-[42ch]">
            Find the students who need support before the results do, and track whether the
            support worked.
          </p>
        </div>

        <form
          className="bg-surface border-hairline rounded-[var(--radius-card)] border p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void run('password');
          }}
        >
          <label className="text-label text-ink-muted block" htmlFor="email">
            College email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-hairline text-body mt-1.5 min-h-[44px] w-full rounded-[var(--radius-control)] border bg-white px-3"
            placeholder="you@college.edu"
          />

          <label className="text-label text-ink-muted mt-4 block" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-hairline text-body mt-1.5 min-h-[44px] w-full rounded-[var(--radius-control)] border bg-white px-3"
          />

          {error ? (
            <p
              role="alert"
              className="text-body-sm mt-4 rounded-[var(--radius-control)] px-3 py-2"
              style={{
                color: 'var(--color-level-critical)',
                background: 'var(--color-level-critical-fill)',
              }}
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={busy !== null} className="mt-5 w-full">
            {busy === 'password' ? 'Signing in…' : 'Sign in'}
          </Button>

          <div className="my-4 flex items-center gap-3">
            <span className="bg-hairline h-px flex-1" />
            <span className="text-body-sm text-ink-faint">or</span>
            <span className="bg-hairline h-px flex-1" />
          </div>

          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void run('google')}
            className="w-full"
          >
            <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34A9 9 0 0 0 9 18Z"
              />
              <path
                fill="#FBBC05"
                d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33Z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
              />
            </svg>
            {busy === 'google' ? 'Signing in…' : 'Continue with Google'}
          </Button>
        </form>

        <p className="text-body-sm text-ink-faint mt-5">
          Demo account: <span className="font-mono">faculty@eduplus.local</span> /{' '}
          <span className="font-mono">eduplus-demo</span>
        </p>
      </div>
    </main>
  );
}
