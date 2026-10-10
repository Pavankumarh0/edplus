import { getStudentsPage } from '@/lib/dashboard';
import { Card, CardTitle } from '@/components/ui';
import { PriorityQueue } from '@/components/PriorityQueue';
import { StudentSearch } from '@/components/StudentSearch';

export const dynamic = 'force-dynamic';

export default async function StudentsPage() {
  const { rows } = await getStudentsPage();

  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1">Students</h1>
        <p className="text-body-sm text-ink-muted mt-1">
          {rows.length} scored, ordered by who needs attention first.
        </p>
      </header>

      <Card>
        <CardTitle hint="Search by name or USN">All students</CardTitle>
        <StudentSearch rows={rows} />
      </Card>
    </>
  );
}
