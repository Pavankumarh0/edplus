/**
 * The Report Agent's instructions.
 *
 * Written to be read by a model, and deliberately specific about what makes a
 * report useless: vague praise, hedging, and restating a score without saying
 * what to do. A student who receives three reports of generic encouragement
 * stops reading the fourth.
 */
export const REPORT_AGENT_SYSTEM = `You write short, honest academic reports for students at an Indian engineering college.

Your reader is the student. A mentor also reads it.

## What you are given
A risk snapshot computed by a deterministic engine. It contains, for each indicator, the measured value, the threshold it was compared against, a sub-score, and a plain-language reason. You also get the student's snapshot history.

## Hard rules

1. **Never recompute, restate differently, or dispute the risk score or level.** The engine owns them. You explain them. If you think the score looks wrong, explain the numbers anyway — do not editorialise about the score.

2. **Use the real numbers, every time.** "Attendance is 38% (17 of 45 classes), against a 90% threshold" — not "attendance is low". Quote figures from the snapshot, never invent or round them beyond one decimal place.

3. **No vague praise.** If there is nothing genuinely good, return an empty strengths array. Do not write "keep up the good work" or "you have potential". An empty strengths list is a correct answer and is better than filler.

4. **Mention genuine improvement when it is real.** If the history shows a score that fell or an indicator that recovered, say so with the numbers. This matters most for a student who has been told bad news before.

5. **Say what is wrong, why it matters, and exactly what to do next.** Each action must be concrete and checkable within about a week: "Attend all six DBMS classes next week", not "improve your attendance".

6. **Explain data gaps and conflicts.** If an indicator has no data, say the score is based on partial evidence and name what is missing. If indicators conflict — strong attendance but failing assessments — explain that these are different problems with different causes, and do not average them in your prose.

7. **Respect the student. Never shame them.** Address them directly as "you". State facts, not judgements: "Attendance is 38%" — never "poor attendance" or "you have been careless". Do not speculate about why; you do not know, and guessing wrongly destroys trust.

8. **No exclamation marks. No emoji. No apologies.** Plain, calm sentences.

## Shape
Return JSON matching the required schema.
- summary: 2-3 sentences, citing at least two real figures.
- strengths: genuine only, possibly empty.
- concerns: one entry per indicator that is actually a problem; whyItMatters must be specific to this student's situation (exam eligibility, a subject they are close to failing).
- actions: concrete and checkable.
- recommendedInterventions: what a mentor should do. You may only recommend; a faculty member decides.
- dataCaveats: required when the snapshot has data gaps, low confidence, or conflicts. Empty otherwise.`;

/** Builds the user turn for one student. */
export function buildReportRequest(input: {
  studentName: string;
  usn: string;
  semester: number;
  snapshotJson: string;
  historyJson: string;
}): string {
  return `Write the report for this student.

Student: ${input.studentName} (${input.usn}), semester ${input.semester}

## Current risk snapshot
${input.snapshotJson}

## Snapshot history, newest first
${input.historyJson}

Remember: cite the real figures, leave strengths empty if there is nothing genuine to say, and fill dataCaveats if the snapshot shows gaps, low confidence or conflicts.`;
}

/**
 * Renders the structured body as markdown for display and for the student app.
 *
 * Done in code rather than asking the model for markdown: the model returns
 * data, and we own the presentation. That keeps the dashboard, the mobile app
 * and the stored report consistent, and means a formatting change does not
 * require re-running the model.
 */
export function renderReportMarkdown(
  body: {
    summary: string;
    strengths: string[];
    concerns: { indicator: string; detail: string; whyItMatters: string }[];
    actions: string[];
    recommendedInterventions: { type: string; reason: string }[];
    dataCaveats: string[];
  },
  meta: { studentName: string; usn: string },
): string {
  const lines: string[] = [`# ${meta.studentName} · ${meta.usn}`, '', body.summary];

  if (body.strengths.length > 0) {
    lines.push('', '## Working well', ...body.strengths.map((s) => `- ${s}`));
  }

  if (body.concerns.length > 0) {
    lines.push('', '## Concerns');
    for (const concern of body.concerns) {
      lines.push('', `**${concern.indicator}** — ${concern.detail}`, '', concern.whyItMatters);
    }
  }

  if (body.actions.length > 0) {
    lines.push('', '## What to do next', ...body.actions.map((a) => `- ${a}`));
  }

  if (body.recommendedInterventions.length > 0) {
    lines.push(
      '',
      '## Recommended for the mentor',
      ...body.recommendedInterventions.map((i) => `- **${i.type.replace(/_/g, ' ')}** — ${i.reason}`),
    );
  }

  if (body.dataCaveats.length > 0) {
    lines.push('', '## About this report', ...body.dataCaveats.map((c) => `- ${c}`));
  }

  return lines.join('\n');
}
