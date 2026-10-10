# Build Brief — EduGuardian AI (CBC 2.0 · PS-055 · Team TONY STARK)

You are building a hackathon project in **~20 hours**. Read this whole brief before writing code. Plan first, then build in the phase order at the bottom. Working software for the judged demo beats extra features.

---

## 0. Setup (do this first)

1. **Skills** — clone Anthropic's official skills repo and install the useful ones into this project:
   ```bash
   git clone --depth 1 https://github.com/anthropics/skills /tmp/anthropic-skills
   mkdir -p .claude/skills
   cp -r /tmp/anthropic-skills/skills/mcp-builder .claude/skills/   # building the MCP server
   cp -r /tmp/anthropic-skills/skills/frontend-design .claude/skills/  # UI quality
   cp -r /tmp/anthropic-skills/skills/webapp-testing .claude/skills/   # Playwright checks
   ```
   (If the folder layout differs, find these skills by name.) Read each SKILL.md before using it.
   Then use `gh search repos` to look for the **most-starred** GitHub repos with Claude Code skills for (a) voice / telephony agents and (b) agent building. Before installing anything, **read its SKILL.md and any scripts**, and only install skills that are clearly relevant and safe. Never run an unread script. List what you installed and why in `docs/SKILLS.md`.
2. **Design references** — use `gh search repos "DESIGN.md"` / "awesome design md" to find the most-starred collection of DESIGN.md files. Pick 1–2 that match the style below and save them to `docs/design/`. Then write our own `docs/design/DESIGN.md` (tokens, type scale, radii, spacing, components) and follow it everywhere.
   Our visual direction (reference images are in `design-refs/`):
   - **Faculty dashboard (web):** light warm-grey canvas, a black vertical icon sidebar, rounded bento cards (radius ~24px), black + **lime/chartreuse (#D9F99D-ish)** accents, big bold numbers, pill-shaped tabs, a pill bar chart. Clean sans font (e.g. Inter / Geist).
   - **Student app (mobile):** white cards on soft pastel gradients (mint, lavender, sky blue), large friendly numbers, a floating pill bottom nav, a horizontal date strip, progress bars made of segments.
   - Risk colours must stay readable and consistent: Stable = green, Watch = amber, At Risk = orange, Critical = red. Never rely on colour alone; always show a label.
3. **Env** — create `.env.example` (never commit real keys):
   `ANTHROPIC_API_KEY, ANTHROPIC_MODEL, FIREBASE_* (client + admin), SARVAM_API_KEY, VIBZ_API_KEY, VIBZ_* (whatever its docs require), PUBLIC_BASE_URL`
   For `ANTHROPIC_MODEL`, check https://docs.claude.com for the current Claude Sonnet model ID. Do not hard-code a model name anywhere else.

---

## 1. The problem we must satisfy (from the official sheet — judged on this)

- **Problem:** Students struggle academically because of poor attendance, low assessment scores or missed submissions. Faculty need to identify students requiring support early.
- **Objective:** Identify students needing attention using academic indicators, and help track interventions.
- **Workflow:** academic records (marks, attendance, submissions) entered → system evaluates **defined** risk indicators → students needing attention are prioritised → faculty record support/intervention actions → student status updated after follow-up.
- **Key requirements:** academic data management · **configurable risk rules** · student prioritisation · intervention tracking · progress history.
- **Edge cases (must be visibly handled):** missing academic data · student improves after intervention · multiple indicators conflict.
- **Scope:** Must-have = data processing, risk identification, prioritisation, intervention tracking. Stretch = predictive risk scoring / personalised recommendations.
- **Demo:** add student records with different indicators → show risk prioritisation → record an intervention → update the result.

---

## 2. One ecosystem, not add-ons

Every part feeds the same loop and the same data:

```
Faculty uploads CSV ─► Firestore (students, records)
        │
        ▼
Risk Engine (deterministic, configurable rules) ─► risk snapshot (score, level, per-indicator reasons, confidence)
        │
        ▼
Claude Report Agent (via shared tools) ─► honest per-student report + recommended interventions
        │
        ▼
Faculty approves intervention (dashboard) ─► intervention record
        │                 ├─► Student app: recovery tasks + report
        │                 └─► Parent Voice Agent: phone call (VIBZ + Sarvam) ─► call outcome saved
        ▼
Next CSV upload ─► risk recalculated ─► new snapshot ─► progress history shows whether it worked
```

**The shared tool layer is the backbone.** One TypeScript module defines every action (read a student, list at-risk students, create an intervention, log a call, …). The **same** tools are:
- exposed as an **MCP server** (so agents and Claude clients manage data through MCP), and
- used by every agent in the app (report agent, faculty copilot, voice agent), each with an **allowlist** of only the tools it needs.

---

## 3. Architecture

**Monorepo layout**
```
apps/web        Next.js (App Router, TypeScript, Tailwind) — faculty dashboard + API routes
apps/mobile     Flutter — student app (Android first)
packages/core   shared TS: Zod schemas, risk engine, tool registry, Firestore repositories, prompts
services/mcp    MCP server (TypeScript, official MCP SDK) exposing packages/core tools
services/voice  small Node (Fastify) service for telephony webhooks + real-time audio (Next.js serverless can't hold WebSockets)
firebase/       firestore.rules, indexes, seed script
docs/           DESIGN.md, ARCHITECTURE.md, DEMO.md, SKILLS.md
sample-data/    demo CSVs
```

**How each technology is used (and only for this)**
| Tech | Role |
|---|---|
| **Next.js** | Faculty dashboard UI + server API routes (CSV import, risk recompute, agent endpoints). Holds secrets server-side only. |
| **Firebase Auth** | Login for faculty (email) and students (email or USN-based). Custom claims: `role = faculty | student`. |
| **Firestore** | Single source of truth: students, academic records, risk rules, risk snapshots, reports, interventions, calls, audit log. |
| **Flutter** | Student app: reads only the logged-in student's own data; can mark recovery tasks done. |
| **Claude (Anthropic API)** | Writes reports, recommends interventions, maps messy CSV headers, powers the faculty copilot and the voice conversation. **Never computes the risk score.** |
| **MCP** | Exposes the shared tools so agents manage data through one controlled, audited interface. |
| **VIBZ** | Telephony provider for outbound calls to parents. |
| **Sarvam AI** | Indian-language speech: speech-to-text, text-to-speech, translation (Kannada, Hindi, English, etc.). Check Sarvam's current API docs for model names and endpoints. |

---

## 4. Data model (Firestore)

- `students/{usn}` — name, usn, semester, section, department, mentorId, parent { name, phone, preferredLanguage } (**parent phone readable by faculty/server only, never by the student app**)
- `students/{usn}/records/{recordId}` — type: attendance | assessment | submission, subject, values, date, sourceUploadId
- `uploads/{id}` — file name, uploader, column mapping used, rows ok / rows rejected, error list, timestamp
- `config/riskRules` — editable rules: indicator weights, thresholds, level cut-offs, minimum data needed (see §5)
- `students/{usn}/snapshots/{id}` — score 0–100, level, per-indicator sub-scores and reasons, confidence, dataGaps[], conflicts[], rulesVersion, createdAt (**this is the progress history**)
- `students/{usn}/reports/{id}` — Claude's report (structured JSON + rendered text), snapshotId it explains, model, createdAt
- `interventions/{id}` — usn, type (mentor meeting, extra class, assignment support, parent call, PTM invite…), reason, status (proposed → approved → in_progress → completed / cancelled), owner, dueDate, notes, baselineSnapshotId, outcomeSnapshotId, outcome (improved | no_change | worsened)
- `students/{usn}/tasks/{id}` — recovery tasks shown in the student app, linked to an intervention
- `calls/{id}` — usn, purpose (absence | ptm | risk_update), language, status, transcript, summary, parentResponse (e.g. confirmed PTM attendance), recordingUrl if available, createdAt
- `audit/{id}` — every tool call: who/which agent, tool, args (redacted), result status, time

Write strict Firestore security rules and test them.

---

## 5. Risk engine (deterministic + configurable) — the core of the judging

Lives in `packages/core/risk`. Pure functions, unit-tested.

- **Indicators:** attendance %, assessment/internal average %, submission completion %, trend (change vs previous snapshot).
- **Rules in `config/riskRules`, editable from a "Risk Rules" page:** weight per indicator, thresholds, level cut-offs (Stable / Watch / At Risk / Critical), and minimum data required. Store `rulesVersion` on every snapshot.
- **Output:** score 0–100, level, and for each indicator its value, sub-score and a plain reason ("Attendance 62% — below the 75% threshold").
- **Edge cases (must show in the UI):**
  - *Missing data:* never invent values. Compute from what exists, lower `confidence`, list `dataGaps`, and show "Insufficient data" if below the minimum. Data gaps appear as a visible badge.
  - *Conflicting indicators* (e.g. high attendance but falling marks): record them in `conflicts[]`, show every indicator separately, and let the report explain the conflict.
  - *Improvement after intervention:* when a new snapshot follows a completed intervention, compare it with `baselineSnapshotId`, set the intervention outcome, and show a before/after.
- **Prioritisation:** sort by level, then score, then worsening trend, then whether an open intervention already exists.
- **Stretch — predictive:** a simple, explainable projection (e.g. linear trend over the last snapshots) plus a "what-if" slider ("if attendance reaches 75%…"). Always label it **Projection, not a guarantee**.

---

## 6. CSV import with automatic filling

- Faculty upload CSV/XLSX files: attendance, internal/assessment marks, submissions. Generate a downloadable template for each.
- **Auto column mapping:** try header heuristics first (USN, name, subject, marks, max marks…). If that fails, ask Claude to propose a mapping as JSON, validated with Zod. Always show a **preview with the mapping and row-level errors** before committing.
- Upsert students by **USN** and append records. Duplicate rows are idempotent. Rejected rows are listed with reasons.
- After the import is committed: recompute risk for the affected students, create snapshots, then queue report generation.
- Create `sample-data/` CSVs covering ~30 students, including: a clearly critical student, a stable one, one with missing marks, one with conflicting indicators, and a second upload where an intervened student improves.

---

## 7. AI agents (Claude, via the shared tools / MCP)

Use the Anthropic TypeScript SDK with tool use. Load each agent's allowed tools from the shared registry. Every tool call is validated with Zod, permission-checked and written to `audit`.

**Tools (initial set):** `get_student`, `get_student_history`, `list_at_risk_students`, `get_risk_breakdown`, `save_report`, `propose_intervention`, `update_intervention`, `create_student_tasks`, `get_call_context`, `log_call_outcome`, `schedule_parent_call`.
Consequential actions (`schedule_parent_call`, approving interventions) need **faculty approval in the UI**. Agents can only *propose* them.

1. **Report Agent** — for each student it gets the snapshot and history, then writes an **honest, specific report**:
   - Use real numbers.
   - Say clearly what is wrong, why it matters, and the exact next steps.
   - Address the student respectfully and never shame them.
   - No vague praise; mention genuine improvements.
   - Explain conflicts and data gaps.
   - Never change the score.
   - Output structured JSON (summary, strengths, concerns[], actions[], recommendedInterventions[]) and save it with `save_report`.
2. **Faculty Copilot** — a chat panel on the dashboard. Questions like "Who needs attention today?", "Why is 1OX21IS045 at risk?", "Draft an intervention for her". It answers from tools only and cites the numbers.
3. **Parent Voice Agent** — see §8.

---

## 8. Parent voice calls (VIBZ + Sarvam + Claude) — parents only, no parent app

**Purpose:** inform parents. Examples:
- "Your ward was absent from college today."
- "There is a parent–teacher meeting on <date> at <time>. Can you attend?"
- A short risk update after an approved intervention.

**Flow:**
1. Faculty clicks "Call parent" (or approves an agent proposal).
2. `schedule_parent_call` creates a `calls` record.
3. The voice service asks VIBZ to place an outbound call.
4. Call connects → Claude writes the message from `get_call_context` (**minimum necessary info only**) → Sarvam TTS speaks it in the parent's preferred language.
5. The parent replies → Sarvam STT → Claude (allowed tools: `get_call_context`, `log_call_outcome` only) → reply via Sarvam TTS.
6. The call ends → transcript + summary + parentResponse (e.g. "will attend PTM") saved → visible on the student's timeline in the dashboard.

**Build it in two tiers, so the demo never fails:**
- **Tier 1 (must work):** pre-generate the message audio with Sarvam TTS, play it on the call, and capture a keypress ("press 1 to confirm you will attend the meeting"). Save the outcome.
- **Tier 2 (upgrade):** a live two-way conversation using real-time audio streaming, if VIBZ supports it.

**Before building, read the VIBZ docs.** Confirm outbound-call API, webhooks, audio playback, DTMF and media streaming. Put telephony behind a `TelephonyProvider` interface with a `VibzProvider` and a **`SimulatedProvider`** (a browser-based fake call that uses the same Sarvam + Claude pipeline) for development and as a demo fallback.

**Guardrails:**
- The agent never discusses marks in detail beyond the approved message.
- It never makes disciplinary decisions.
- It identifies itself as an automated assistant from the college.
- If the parent asks for a human, it offers a callback from the mentor.
- Only call numbers stored on the student record.

---

## 9. Faculty dashboard (Next.js) — screens

1. **Overview** — counts by level, priority queue (top students needing attention), recent uploads, open interventions, today's calls.
2. **Upload** — drag-and-drop CSV, mapping preview, errors, commit.
3. **Students** — searchable table with level pill, score, trend arrow, data-gap and conflict badges.
4. **Student detail** — indicator breakdown, risk history chart (snapshots), Claude's report, interventions timeline (with before/after), calls with transcripts, "Call parent", "Create intervention", what-if projection.
5. **Interventions** — board by status; complete one → outcome recorded on next upload.
6. **Risk Rules** — edit weights and thresholds, then "Recalculate all" (bumps `rulesVersion`).
7. **Copilot** — slide-over chat on every page.

## 10. Student app (Flutter)

Login → **Home:** status card (level + score + "why" in plain words), today's tasks, attendance ring, streak/badges (positive only — no leaderboards that shame).
Other screens: **Report** (latest Claude report), **Tasks** (recovery tasks from interventions, mark done), **Progress** (history chart, before/after), **Schedule** (date strip like the reference).
Reads only the student's own documents (enforced by Firestore rules). Follow the mobile design reference.

---

## 11. Quality bar

- Unit tests for the risk engine (including all three edge cases), CSV mapping and the Firestore rules.
- Strict TypeScript; Zod at every boundary; no secrets in client code or the Flutter app.
- Seed script: `npm run seed` loads demo data. `npm run demo:reset` restores the pre-demo state.
- Use the webapp-testing skill to click through the demo flow with Playwright before calling the work done.
- `docs/DEMO.md` — exact 5-minute demo script:
  1. Upload CSV 1.
  2. Show the priority queue, the missing-data student and the conflict student.
  3. Open the critical student's report.
  4. Approve an intervention.
  5. Parent call about the PTM (live, or simulated as a fallback).
  6. Student app shows the tasks.
  7. Upload CSV 2.
  8. The score drops and the intervention is marked "improved".

---

## 12. Build order (20 hours — must-haves first)

| Hours | Deliverable |
|---|---|
| 0–1 | Repo, skills, design tokens (DESIGN.md), Firebase project, env, schemas |
| 1–5 | CSV import + auto-mapping + Firestore data + seed data |
| 5–8 | Risk engine + configurable rules + snapshots + prioritised dashboard **(must-haves demo-able here)** |
| 8–10 | Interventions + progress history + before/after on re-upload |
| 10–12 | Shared tool registry + MCP server + Report Agent + Copilot |
| 12–15 | Parent voice: Tier 1 with VIBZ + Sarvam, plus SimulatedProvider |
| 15–18 | Flutter student app (home, report, tasks, progress) |
| 18–20 | Polish UI, tests, Playwright demo run, DEMO.md, rehearse. Tier 2 voice only if everything else is solid. |

**Out of scope for now (future work, do not build):** Telegram bot, ESP32/IoT hardware, parent app.

Start by writing `docs/ARCHITECTURE.md` with the plan and a data-flow diagram (Mermaid). Confirm the VIBZ and Sarvam API capabilities from their docs, then begin Phase 1.
