import type { Metadata } from 'next';
import { ExitBoard } from '@/components/ExitBoard';

export const metadata: Metadata = { title: 'Classroom exit · EduPlus AI' };

export default function ExitPage() {
  return <ExitBoard />;
}
