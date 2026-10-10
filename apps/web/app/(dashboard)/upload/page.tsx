import { Card, CardTitle } from '@/components/ui';
import { UploadFlow } from '@/components/UploadFlow';

export const dynamic = 'force-dynamic';

export default function UploadPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1">Upload academic data</h1>
        <p className="text-body-sm text-ink-muted mt-1 max-w-[70ch]">
          Attendance, internal assessment marks or assignment submissions. Columns are matched
          automatically; you confirm the mapping before anything is written.
        </p>
      </header>

      <UploadFlow />

      <Card className="mt-5">
        <CardTitle>How this works</CardTitle>
        <ol className="text-body-sm text-ink-muted max-w-[72ch] list-decimal space-y-2 pl-5">
          <li>
            Column names are matched by simple rules first. A file using the template headers
            needs no AI at all.
          </li>
          <li>
            Only if that fails is Claude asked to propose a mapping — and every column it names
            is checked against the real header row before it is trusted.
          </li>
          <li>
            You see the mapping and every rejected row <strong>before</strong> committing.
            Nothing is written until you press commit.
          </li>
          <li>
            On commit, students are upserted by USN, records are written with deterministic ids
            (so re-uploading a corrected file overwrites rather than double-counts), risk is
            recomputed, and any completed intervention gets its outcome.
          </li>
        </ol>
      </Card>
    </>
  );
}
