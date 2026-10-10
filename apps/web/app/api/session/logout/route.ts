import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/lib/auth';

/**
 * Sign-out as a plain form POST, so the sidebar button works without
 * JavaScript and without turning the whole rail into a client component.
 */
export async function POST() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
