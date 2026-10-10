import type { Metadata } from 'next';
import { AssignmentsBoard } from '@/components/AssignmentsBoard';

export const metadata: Metadata = { title: 'Assignments · EduPlus AI' };

/**
 * Client-rendered: submissions arrive while the page is open, and the QR has
 * to appear the instant an assignment is created rather than after a round
 * trip — a mentor is standing in front of a class when they press the button.
 */
export default function AssignmentsPage() {
  return <AssignmentsBoard />;
}
