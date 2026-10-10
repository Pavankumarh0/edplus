import { NextResponse } from 'next/server';
import { RecordTypeSchema, templateCsv, templateFileName } from '@eduplus/core';

/**
 * Downloadable CSV template, one per record type.
 *
 * The headers are exactly the ones the heuristic matcher recognises at top
 * rank, so a file started from a template never needs the Claude mapping path.
 */
export async function GET(_request: Request, context: { params: Promise<{ type: string }> }) {
  const { type } = await context.params;
  const parsed = RecordTypeSchema.safeParse(type);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Unknown template. Use attendance, assessment or submission.' },
      { status: 404 },
    );
  }

  return new NextResponse(templateCsv(parsed.data), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${templateFileName(parsed.data)}"`,
      'cache-control': 'no-store',
    },
  });
}
