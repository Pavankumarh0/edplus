import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { RecordType } from '@eduplus/core';
import { anthropic, model } from './client';

/**
 * What Claude is asked to return. Values must be column names taken verbatim
 * from the file; `finaliseMapping` rejects anything that is not actually in
 * the header row, which is the guard against a confidently invented column.
 */
const ProposalSchema = z.object({
  usn: z.string().min(1),
  value: z.string().min(1),
  name: z.string().nullable(),
  subject: z.string().nullable(),
  maxValue: z.string().nullable(),
  date: z.string().nullable(),
  semester: z.string().nullable(),
  section: z.string().nullable(),
  department: z.string().nullable(),
  parentName: z.string().nullable(),
  parentPhone: z.string().nullable(),
  parentLanguage: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(600),
});

const MAPPING_SYSTEM = `You map spreadsheet column headers onto a fixed set of fields for an academic records importer.

You are given the header row, a few sample data rows, and the type of record being uploaded. Return which column feeds which field.

Rules:
- Every value you return must be a column name copied EXACTLY from the header list, character for character. Never invent, correct or tidy a column name.
- Use null for any field the file does not contain. Null is the right answer far more often than a guess.
- usn and value are required. usn identifies the student (University Seat Number, roll number, registration number). value is the achieved number.
- What "value" and "maxValue" mean depends on the record type:
    attendance  -> value = classes attended,   maxValue = classes held
    assessment  -> value = marks obtained,     maxValue = maximum marks
    submission  -> value = submissions made,   maxValue = submissions expected
- Use the sample rows to tell columns apart. If two columns could be the numerator, the one whose values are never larger than the other is the numerator.
- A column of percentages with no paired total means value is that column and maxValue is null.
- confidence: how sure you are overall, 0 to 1. Be honest; a low number tells a human to check rather than hiding the doubt.
- reasoning: one or two sentences on anything ambiguous, for the human reviewing the preview.`;

export interface MappingProposal {
  mapping: Record<string, string | null>;
  confidence: number;
  reasoning: string;
}

/**
 * Asks Claude to map headers the heuristics could not resolve.
 *
 * Only reached when `heuristicsAreSufficient` is false, so a well-named file
 * never pays for this. The result is validated twice: once against this
 * schema, and again by `finaliseMapping`, which checks every proposed column
 * actually exists in the file.
 */
export async function proposeMappingWithClaude(input: {
  headers: string[];
  recordType: RecordType;
  sampleRows: Record<string, string>[];
  partial: Partial<Record<string, string>>;
}): Promise<MappingProposal> {
  const client = anthropic();

  const response = await client.messages.create({
    model: model(),
    max_tokens: 2000,
    system: MAPPING_SYSTEM,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            usn: { type: 'string' },
            value: { type: 'string' },
            name: { type: ['string', 'null'] },
            subject: { type: ['string', 'null'] },
            maxValue: { type: ['string', 'null'] },
            date: { type: ['string', 'null'] },
            semester: { type: ['string', 'null'] },
            section: { type: ['string', 'null'] },
            department: { type: ['string', 'null'] },
            parentName: { type: ['string', 'null'] },
            parentPhone: { type: ['string', 'null'] },
            parentLanguage: { type: ['string', 'null'] },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
          required: [
            'usn', 'value', 'name', 'subject', 'maxValue', 'date',
            'semester', 'section', 'department', 'parentName', 'parentPhone',
            'parentLanguage', 'confidence', 'reasoning',
          ],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: 'user',
        content:
          `Record type: ${input.recordType}\n\n` +
          `Headers (copy values from this list exactly):\n${JSON.stringify(input.headers)}\n\n` +
          `Sample rows:\n${JSON.stringify(input.sampleRows, null, 2)}\n\n` +
          (Object.keys(input.partial).length > 0
            ? `Columns already matched by simple heuristics (reuse unless clearly wrong):\n${JSON.stringify(input.partial, null, 2)}\n\n`
            : '') +
          'Return the mapping.',
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to map these columns.');
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Claude did not return a usable column mapping. Map the columns by hand.');
  }

  const proposal = ProposalSchema.parse(parsed);
  const { confidence, reasoning, ...mapping } = proposal;

  return { mapping, confidence, reasoning };
}
