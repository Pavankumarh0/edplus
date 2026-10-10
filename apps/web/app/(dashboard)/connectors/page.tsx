import type { Metadata } from 'next';
import { ConnectorsBoard } from '@/components/ConnectorsBoard';

export const metadata: Metadata = { title: 'Connectors · EduPlus AI' };

/**
 * Client-rendered, unlike the rest of the dashboard.
 *
 * Toggling a tool has to show its effect immediately — the whole point of the
 * page is that switching one off changes what the agents can do right now —
 * and a server-rendered page would need a full round trip per toggle.
 */
export default function ConnectorsPage() {
  return <ConnectorsBoard />;
}
