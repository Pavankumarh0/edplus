import { getDb, getRiskRules, listStudents } from '@eduplus/core/repositories';
import { RulesEditor } from '@/components/RulesEditor';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const db = getDb();
  const [rules, students] = await Promise.all([getRiskRules(db), listStudents(db)]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1">Risk rules</h1>
        <p className="text-body-sm text-ink-muted mt-1 max-w-[74ch]">
          These numbers decide who gets flagged. Every snapshot records the version that produced
          it, so a historical score can always be explained by the rules in force at the time.
          Currently v{rules.rulesVersion}.
        </p>
      </header>

      <RulesEditor rules={rules} studentCount={students.length} />
    </>
  );
}
