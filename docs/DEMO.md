# Demo script — 5 minutes

**EduPlus AI · CBC 2.0 · PS-055 · Team TONY STARK**

Read this once before presenting. The timings are a guide; the **bold** lines
are what to actually say.

---

## Accounts

| Who | Email | Password | USN |
|---|---|---|---|
| **Faculty** (dashboard) | `faculty@eduplus.local` | `eduplus-demo` | — |
| **Student** (mobile app) | `ananya@eduplus.local` | `eduplus-demo` | 1OX21IS045 |
| Pavan Kumar H — **real parent phone** | `pavan@eduplus.local` | `eduplus-demo` | 1OX21IS050 |
| Yadava HC — **real parent phone** | `yadava@eduplus.local` | `eduplus-demo` | 1OX21IS051 |
| Bhavani Patil — **real parent phone** | `bhavani@eduplus.local` | `eduplus-demo` | 1OX21IS052 |
| Aarav Sharma (stable, spare) | `aarav@eduplus.local` | `eduplus-demo` | 1OX21IS001 |

**Pavan, Yadava and Bhavani are the three to call** — their parent contacts are
real numbers. Everyone else has an invented one; see the warning below.

> **If a real call does not ring:** check the Vobiz call record rather than the
> code. A `Busy Line` cause from `hangup_source: Carrier`, with `bill_duration: 0`
> and no `answer_time`, means the network refused it — on Indian mobiles that is
> usually DND, which blocks automated calls and reports them as busy. The call
> panel now says so instead of a bare "no answer". Use the simulator if the
> number cannot be cleared in time.

Students change their own password from the **Account** screen in the app
(tap the avatar on Home). Faculty never see it — the student page shows only
the email, whether they have signed in, and whether the account is correctly
linked to the USN.

These exist in **both** the live project and the emulator. The mobile app talks
to the **live** project, so the phone works without your laptop.

---

## Making the call ring a real phone

The seeded parent numbers are **invented**. Dialling one would ring a stranger.
Before switching to real calls:

```bash
# 1. Point the demo student's parent contact at YOUR phone
npm run demo:phone -- +91XXXXXXXXXX --live

# 2. Expose the voice service publicly — Vobiz fetches the audio itself,
#    so localhost cannot work
ngrok http 8787

# 3. In .env.local
PUBLIC_BASE_URL=https://<your-ngrok-subdomain>.ngrok-free.app
TELEPHONY_PROVIDER=vobiz

# 4. Restart the voice service, then check it is ready
curl http://127.0.0.1:8787/health      # providerReady must be true
```

Leave `TELEPHONY_PROVIDER=simulated` and the call plays **inside the
dashboard** instead — audio and keypad in a panel, no phone needed. That is
the safer default for a judged demo.

---

## Before you start (10 minutes earlier)

```bash
# 1. Terminal A — Firebase emulators (skip if demoing against the live project)
npm run emulators

# 2. Terminal B — reset to the pre-demo state
npm run demo:reset:emulator        # emulator
# npm run demo:reset -- --live     # live project

# 3. Terminal C — voice service
npm run dev:voice

# 4. Terminal D — dashboard
npm run dev:emulator               # emulator
# npm run dev                      # live project
```

Then:

- Open **http://localhost:3000** — note **localhost**, not `127.0.0.1`.
  Next 16 blocks cross-origin dev resources, and on `127.0.0.1` the page
  renders but never hydrates, so every form looks dead.
- Sign in as `faculty@eduplus.local` / `eduplus-demo`.
- You should see **"No students yet"**. That is correct — the demo opens by
  uploading, and a dashboard that is already full makes step 1 invisible.
- Have `sample-data/` open in a file picker.

**Check before you present:** `curl http://localhost:8787/health` should report
`providerReady`, `sarvam: configured` and `anthropic: configured`.

---

## The 30-second framing

> **Colleges already know which students are in trouble. The data is sitting in
> three spreadsheets that nobody joins up until the results come out, and by
> then it is too late.**
>
> **EduPlus reads those spreadsheets, scores every student against rules the
> college writes, and tells a mentor who to see on Monday morning — and then
> tells them whether it worked.**

---

## 1 · Upload (45s)

Go to **Upload** → Attendance → drop `sample-data/01-attendance-march.csv`.

> **The columns are matched automatically. No AI was needed here — these are
> ordinary header names and plain rules handle them. Claude is only asked when
> the headers are genuinely messy, and even then every column it proposes is
> checked against the real header row before we trust it.**

Point at the preview: **90 rows ready · 0 rejected · 30 students**.

> **Nothing is written until I press commit. I can see the mapping and every
> row that would fail, first.**

Commit. Repeat quickly for `02-assessment-march.csv` and
`03-submissions-march.csv`.

> **That last commit rescored all thirty students.**

---

## 2 · The queue, and the two hard cases (70s)

Go to **Overview**.

> **Four critical, seven at risk. The queue is ordered by level, then score,
> then who is getting worse — and then by who has nobody working with them
> yet. It answers "who is unattended?", not just "who is worst?".**

Point at **Waiting on data** → Fatima Khan.

> **This is the first edge case. We have her attendance and nothing else. We
> do not guess the missing marks and we do not score them as zero — the
> indicator is excluded, confidence drops to 35%, and she is flagged
> Insufficient data in slate, deliberately not on the green-to-red scale.
> She needs data entry, not an intervention. A system that showed her as
> "fine" would be lying.**

Open **1OX21IS012 Rohan Mehta** (from Students, or search).

> **Second edge case. Attendance 96%, submissions 92% — and he is failing every
> assessment. The weighted average puts him at 37, which is only "Watch".**
>
> **So we escalate: one indicator severe enough on its own raises the level,
> without touching the score. The score stays an honest weighted mean anyone
> can recompute by hand; the level tells the truth. That is him moved from
> Watch to At Risk, and the reason is written on the card.**

---

## 3 · The critical student and the report (60s)

Open **1OX21IS045 Ananya Reddy**.

> **Score 100. Attendance 37.8%, assessment average 14%.**

Point at the indicator bands.

> **Every number is drawn against what it is measured against — the threshold
> and the critical floor, with the engine's own sentence underneath. A bare
> "38%" is an accusation; "38% against a 90% threshold, where 75% is the exam
> eligibility bar" is evidence.**

Press **Generate report** (~20s).

> **Claude reads the snapshot and history through the shared tool layer — the
> same tools the MCP server exposes, allowlisted and audited. It explains the
> score. It never computes it.**

Read one line aloud from the result, then:

> **No vague praise. If there were nothing genuine to say, the strengths list
> would be empty, and that is the correct answer.**

---

## 4 · Intervene (45s)

**Create intervention** → Mentor meeting → paste the reason → leave *Approve
immediately* ticked → create.

> **The agent can only ever propose. Approving is a human action, and that is
> enforced in the tool layer, not just hidden in the UI.**

> **Approving also froze the baseline score — 100 — and created three recovery
> tasks written for the student.**

---

## 5 · Call the parent (50s)

**Call parent** → Parent–teacher meeting → show the pre-filled message.

> **The agent will say exactly this and nothing more. It is not given her
> marks, her score or the report — so there is nothing to leak. Her mother's
> preferred language is Telugu, and Sarvam speaks it.**

Press **Call now**. The call goes out immediately — with
`TELEPHONY_PROVIDER=vobiz` the phone in your hand rings and the panel shows the
parent's keypress as it lands; on `simulated` the panel plays the audio inline
and you answer it yourself. Either way it is one click, and if the call cannot
be placed you are told so straight away rather than it sitting silently in a
queue.

> **This is a stand-in for her mother's phone. Same approved message, same
> Sarvam speech, same record written — only the telephone network is missing.
> Swapping to a real Vobiz call is an environment variable.**

Play the audio, press **1**.

> **Outcome recorded: will attend.**

Back on her page, scroll to **Parent calls** — the transcript and outcome are
on her timeline.

---

## 6 · The student's side (30s)

Open the Flutter app (emulator or device), signed in as
`ananya@eduplus.local` / `eduplus-demo`.

> **Her own view. The level first, in plain words, then the number. Her tasks.
> Her attendance ring, with the 75% bar marked on it.**
>
> **What she cannot see is her mother's phone number — that lives in a
> subcollection students are denied at the Firestore rules level, because rules
> authorise whole documents, not fields. We have a test that proves it.**

---

## 7 · Did it work? (40s)

Back to **Upload** → load `04`, `05`, `06-april.csv` (attendance first).

> **New month, new data.**

After the last commit, the banner says interventions now have an outcome.

Open Ananya.

> **100 to 36.7. Critical to Watch. The intervention is marked improved — and
> nothing marked its own homework: the verdict comes from the next batch of
> real attendance and marks, compared against the baseline we froze when the
> intervention was created.**

Point at the before/after card and the chart.

> **And here is Shaurya Verma, who got worse despite outreach — 83.6 to 97.9.
> We show that too. A system that only ever reports success is not measuring
> anything.**

---

## Close (15s)

> **Deterministic engine decides who. Claude explains why and drafts what to
> do. A human decides whether to act. The rules are editable by the college,
> every score records the rule version that produced it, and every tool call —
> including every refusal — is in an audit log.**

---

## If something breaks

| Symptom | Fix |
|---|---|
| Forms do nothing, page looks dead | You are on `127.0.0.1`. Use **localhost:3000**. |
| "Wrong password" with correct password | `NEXT_PUBLIC_*` not reaching the browser — restart the dev server. |
| Report button errors | `ANTHROPIC_API_KEY` missing from `.env.local`, or rate-limited. Skip to step 4; the seeded report is already there if you ran `npm run seed`. |
| Call panel is silent | The browser blocked autoplay. Press the **Play** button in the panel. |
| Real call does not ring | `providerReady` is false — check ngrok is running and `PUBLIC_BASE_URL` is the https URL. |
| Voice service unreachable | Terminal C. `npm run dev:voice`. |
| Emulator port in use | `npm run emulators:kill` then restart. |
| Everything is on fire | `npm run seed:emulator -- --april` loads the full finished state, then narrate from step 2. |

**The safety net:** `npm run seed:emulator -- --april` gives you the entire
demo already done — 30 students, reports, a completed intervention marked
improved. If the live upload fails, switch to that and keep talking.

---

## Numbers worth knowing

<!-- Re-checked against the live project on 11 Oct 2026. The earlier figures
     here had drifted from the data and would not have survived a judge
     looking at the screen. -->

- 33 students scored · 3 critical · 6 at risk · 8 watch · 15 stable · 1 insufficient data
- Ananya 1OX21IS045: **100 → 36.7**, improved
- Shaurya 1OX21IS020: **97.9**, critical — worsened despite outreach
- Rohan 1OX21IS012: **28.7**, Watch — attendance 97.8% and submissions 100%
  against assessments 24%, so the engine names **two conflicts**. He does NOT
  escalate: his assessment sub-score is 82, under the 85 trigger.
- Fatima 1OX21IS023: insufficient data, **2 gaps, confidence 0.45**
- Nobody in the current data trips the escalation rule — describe it, do not
  claim it is on screen
- 298 unit tests · 65 emulator tests · 15 Flutter tests
