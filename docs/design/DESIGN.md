# EduPlus AI — design system

Two surfaces, one data model:

- **Faculty dashboard** (web) — a working tool for a mentor with 60 students and
  twenty minutes. Dense, calm, evidence-first.
- **Student app** (mobile) — a personal, encouraging view of one student's own
  position. Soft, roomy, never shaming.

They look different on purpose. The same risk level must still read identically
in both.

> **Note on references.** The brief says reference images are in `design-refs/`.
> That folder is empty — the images were never added. This system is built from
> the brief's written direction, which is specific enough to follow exactly
> (warm-grey canvas, black icon rail, ~24px bento cards, lime accents, big bold
> numbers, pill tabs, pill bar chart). If the images turn up, check this file
> against them before changing code.

---

## 1. The one idea

**Never show a number without showing what it is measured against.**

This product exists to justify flagging a student. A bare "62%" is an
accusation; "62%, where risk starts at 90% and 40% is critical" is evidence. So
the signature component is not a big number — it is the **indicator band**
(§6.2), which draws the student's value on the same track as the threshold and
the critical floor.

That is also a direct visual expression of the risk engine's single scoring
formula, so the UI teaches the model rather than hiding it.

Big bold numbers still appear, as the brief asks. They are the entry point; the
band is the answer.

---

## 2. Colour

### Canvas and ink

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F2F0EB` | Page background. Warm grey, not cream. |
| `surface` | `#FBFAF8` | Bento cards. |
| `surface-sunk` | `#EAE7E0` | Inset wells, chart tracks, table header. |
| `ink` | `#121110` | Primary text, the sidebar, filled buttons. |
| `ink-muted` | `#5C5852` | Secondary text, labels. |
| `ink-faint` | `#8F8A82` | Tertiary text, axis ticks. |
| `hairline` | `#DDD9D1` | 1px borders. |

`ink` is a **warm** near-black (`#121110`), not `#0B0B0B` or `#111`. A cold black
on a warm-grey canvas reads as two unrelated palettes. This is deliberate: the
whole page shares one temperature.

### Accent

| Token | Hex | Use |
|---|---|---|
| `lime` | `#D9F99D` | The accent. Fills, highlighted cells, active pill. |
| `lime-edge` | `#7B9C2F` | Borders and icons on a light surface (3.03:1). |
| `lime-text` | `#627C25` | The only lime dark enough for text (4.55:1). |

**Lime never carries text.** Its contrast against white is 1.3:1. Text on lime
is always `ink` (14.9:1). Lime is a *surface*, never a foreground.

Use lime for exactly one thing per screen — the thing you want looked at first.
Two lime areas in one view and neither reads as primary.

### Risk levels

Readable, consistent, and **never the only signal**. Every level renders as a
pill with a written label; colour is reinforcement.

| Level | Text/border | Fill | Contrast | Label |
|---|---|---|---|---|
| Stable | `#195936` | `#DCF2E4` | 7.08 | Stable |
| Watch | `#704900` | `#FBF0D2` | 7.00 | Watch |
| At Risk | `#7C380E` | `#FBE3D2` | 7.01 | At Risk |
| Critical | `#8D1A1A` | `#FBDAD9` | 7.03 | Critical |
| Insufficient data | `#484866` | `#E6E6F0` | 7.08 | Insufficient data |

All five text-on-fill pairs clear **7:1 (AAA)**, measured rather than assumed —
the ratios above are computed, and `npm run check:contrast` re-checks them.
Chosen for legibility first and to stay distinguishable under the commonest
colour-vision deficiencies: green and red differ in lightness as well as hue,
so they do not collapse into each other for a deuteranope.

"Insufficient data" is a **fifth visual state**, not a level. It is slate, so it
cannot be mistaken for a position on the green→red scale. A student we know
nothing about must never look like a student we know is fine.

### Charts

Sequential track for the indicator band, light → dark:
`#EAE7E0` (unfilled) → the level's own fill → the level's own text colour.

Snapshot history line: `ink` with lime dots. Only one series, so no categorical
palette is needed. Where a baseline/outcome pair is shown, the baseline is
`ink-faint` and the outcome is the level colour.

---

## 3. Type

**Inter** throughout (variable). One family, used across a wide weight range so
hierarchy comes from weight and size rather than from mixing typefaces.
Fallback stack: `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.

Numbers use Inter's tabular figures (`font-variant-numeric: tabular-nums`)
everywhere a figure can change or sits in a column — scores, percentages, table
cells. Proportional figures make a dashboard twitch when a score updates.

| Role | Size / line-height | Weight | Tracking |
|---|---|---|---|
| `display` — the one hero number | 56 / 1.0 | 680 | -0.03em |
| `metric` — card numbers | 34 / 1.1 | 640 | -0.02em |
| `h1` — page title | 26 / 1.25 | 600 | -0.015em |
| `h2` — card title | 17 / 1.35 | 600 | -0.01em |
| `body` | 15 / 1.55 | 440 | 0 |
| `body-sm` — reasons, captions | 13.5 / 1.5 | 440 | 0 |
| `label` | 12.5 / 1.3 | 560 | 0.01em |
| `mono` — USN only | 13 / 1.4 | 500 | 0 |

**Labels are sentence case, never tracked-out caps.** `Attendance`, not
`ATTENDANCE`. Caps labels are the strongest tell of a templated dashboard and
they read slower.

The only monospace is the USN (`ui-monospace, "SF Mono", Menlo, Consolas,
monospace`), because it is an identifier that gets scanned and compared
character by character. Nothing else is monospace.

Prose caps at ~70 characters. Claude's reports are read, not skimmed.

---

## 4. Radius, elevation, spacing

### Radius — varies by role, deliberately

A single radius on everything is the SaaS-card tell. Here radius encodes how
large and how interactive a thing is:

| Token | Value | Applies to |
|---|---|---|
| `radius-card` | 24px | Bento cards (per the brief) |
| `radius-hero` | 32px | The one oversized hero card |
| `radius-control` | 10px | Inputs, selects, table cells |
| `radius-pill` | 999px | Level pills, tabs, bar-chart bars |

### Elevation — mostly none

Cards sit on the canvas by **contrast**, not shadow: `surface` is lighter than
`canvas` and carries a `hairline` border. That is enough.

| Token | Value | Applies to |
|---|---|---|
| `shadow-none` | — | Default for every card |
| `shadow-raised` | `0 1px 2px rgba(18,17,16,.05), 0 8px 24px -12px rgba(18,17,16,.14)` | Only things genuinely floating: the copilot slide-over, the mobile bottom nav, dropdowns |

One identical soft grey shadow under every card is the other half of the
SaaS-card tell. Avoided.

### Spacing

4px base. Use `4 8 12 16 20 24 32 40 56 72`. Card padding is 24; the hero card
is 32. Grid gap is 16 on mobile, 20 on desktop.

---

## 5. Layout

### Faculty dashboard

```
┌────┬──────────────────────────────────────────────────────────────┐
│    │  Overview                              [Mar 2026 ▾]  [⌘K]   │
│ ▓▓ ├──────────────────────────────────────────────────────────────┤
│    │ ┌─────────────────────────┐ ┌──────────┐ ┌──────────┐        │
│ ◇  │ │ 4                       │ │ 7        │ │ 15       │        │
│    │ │ Critical                │ │ At Risk  │ │ Stable   │        │
│ ▤  │ │ ───────── pill bars ─── │ │          │ │          │        │
│    │ └─────────────────────────┘ └──────────┘ └──────────┘        │
│ ◈  │ ┌────────────────────────────────────┐ ┌──────────────────┐  │
│    │ │ Needs attention first              │ │ Open work        │  │
│ ⚙  │ │  ① 1OX21IS045  Ananya   100 [Crit] │ │ 1 intervention   │  │
│    │ │  ② 1OX21IS020  Shaurya   98 [Crit] │ │ 2 calls today    │  │
│    │ │  ③ 1OX21IS012  Rohan     37 [Risk] │ │                  │  │
│    │ │     ↑ escalated: assessment        │ │ Recent uploads   │  │
│    │ └────────────────────────────────────┘ └──────────────────┘  │
└────┴──────────────────────────────────────────────────────────────┘
  72px                        12-col fluid, max 1440
```

- **Black icon rail**, 72px, fixed. Icons only, each with a tooltip and an
  `aria-label`. The active item is a lime square with `radius-control`.
- **Bento grid**, 12 columns, asymmetric. The priority queue is the widest card
  because it is the product's actual job. Level-count tiles are small.
- Content is **left-aligned** throughout. Numbers in tables are right-aligned so
  digits line up; their headers align with them.
- The queue is **numbered** — ①②③ — because it genuinely is a ranked sequence.
  (Numbering is only used where order carries meaning; nowhere else.)

### Student app

```
┌──────────────────────────────┐
│  Tue 10 Mar                  │   ← date strip, horizontal scroll
│  ▸ 8  9 [10] 11 12 13        │
├──────────────────────────────┤
│ ╭──────────────────────────╮ │
│ │  mint → sky gradient     │ │   ← status card, radius-hero
│ │                          │ │
│ │  Watch                   │ │   ← label first, then number
│ │  37                      │ │
│ │  Attendance is back to   │ │
│ │  72%. Keep it above 90%. │ │
│ │  ▰▰▰▰▰▱▱▱  5 of 8        │ │   ← segmented progress
│ ╰──────────────────────────╯ │
│  Today                       │
│  ☐ Sit the CN retest         │
│  ☑ Submit OS assignments     │
├──────────────────────────────┤
│   ◉ Home  ○ Report  ○ Tasks  │   ← floating pill nav, shadow-raised
└──────────────────────────────┘
```

Pastel gradients, white cards, generous space. Gradients are **backgrounds
only** — never behind text that needs to be read at small size.

| Gradient | From → to |
|---|---|
| `mint` | `#DFF5EA` → `#CFE9F7` |
| `lavender` | `#E8E2F7` → `#F3E4F0` |
| `sky` | `#DCEBFA` → `#E6F4F1` |

Which gradient a student sees is tied to their **level**, not rotated for
variety, so the card's feel is consistent with its label.

---

## 6. Components

### 6.1 Level pill

`radius-pill`, level fill, 1px level-coloured border at 35% opacity, level text
colour, `label` type, 6px × 12px padding. **Always contains the written label.**

Never a bare coloured dot. Never colour alone.

### 6.2 Indicator band — the signature component

```
Attendance                                    72%
      ┌──────────────────────────────────────────┐
      │░░░░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓│              │
      └──────────────────────────────────────────┘
       40                        72             90
       critical                 you         target
Attendance 72% (97 of 135) — below the 90% threshold.
```

- Track is `surface-sunk`, `radius-pill`, 10px tall.
- Fill runs from 0 to the student's value, in the level's colour.
- Two tick marks: `criticalAt` and `threshold`, labelled with their numbers.
- The engine's own `reason` string sits underneath, verbatim.

The reason text is generated once in `packages/core/risk/score.ts` and reused by
the dashboard, the student app, Claude's report and the MCP tools. If the
dashboard and the report explained the same number differently, nobody would
trust either.

**Unavailable indicator:** the track renders as a dashed outline with no fill,
and the caption is the data-gap sentence. It is never drawn at zero — an empty
bar and a bar at zero mean opposite things.

### 6.3 Pill bar chart

Horizontal bars, `radius-pill`, one row per level, bar length by count, value at
the end of the bar. Lime fills only the row currently filtered on.

### 6.4 Pill tabs

A `surface-sunk` track containing `radius-pill` segments. The active segment is
lime with `ink` text. Keyboard: arrow keys move, `role="tablist"`.

### 6.5 Data-gap badge

Slate, `radius-pill`, with a count: `3 data gaps`. Clicking opens the list of
missing indicators. It appears next to the level pill, never instead of it.

### 6.6 Escalation note

When `snapshot.escalation` is set, the level pill gets a small upward caret and
the card shows the escalation reason in `body-sm` on a `lime` strip. This is the
only place lime appears outside the primary accent slot, because the whole point
is that the level is higher than the number suggests and that needs to catch the
eye.

### 6.7 Projection

Dashed line, `ink-faint`, with the label **Projection, not a guarantee** always
rendered adjacent — not in a tooltip. A projection whose caveat is hidden behind
a hover is a projection presented as fact.

---

## 7. Quality floor

Not optional, not announced in the UI:

- Responsive to 360px. The icon rail becomes a bottom bar under 768px.
- Visible keyboard focus everywhere: 2px `ink` outline, 2px offset. Never
  `outline: none` without a replacement.
- `prefers-reduced-motion: reduce` disables transitions and the one page-load
  sequence.
- Every interactive target ≥ 44×44px on touch.
- Tables use real `<th scope>`; the priority queue is a table, not a div grid.
- Body text ≥ 4.5:1, large text and non-text borders ≥ 3:1. Enforced by
  `npm run check:contrast`, which fails the build on a regression rather than
  trusting a hand-written claim in this file.
- Loading states are skeletons matching final layout, so nothing reflows.
- Empty states say what to do next: "No students yet. Upload a CSV to begin."

## 8. Motion

One orchestrated moment: on the Overview, the level-count tiles count up from 0
once, over 400ms, staggered 60ms. Nothing else animates on load.

Everything else is response to an action — a card expanding, a slide-over
opening, a row committing — at 150–200ms, `cubic-bezier(.2,.7,.3,1)`.

No fade-and-slide-up on every section. No hover lift on every card.

## 9. Voice

Plain, specific, never cute. The product is telling a mentor that a real student
is in trouble.

- Say the number and what it is measured against.
- Name the student, not "the subject".
- Buttons say what happens: **Approve intervention**, not **Submit**. The action
  keeps its name through the flow — "Approve intervention" produces "Intervention
  approved".
- Never shame a student. "Attendance is 38%" — not "poor attendance".
- To a student, address them directly and say what to do next.
- No exclamation marks in risk context. No "Oops". Errors say what happened and
  how to fix it.
- Mention genuine improvement when it is real, and say nothing when it is not.
  Vague praise teaches a student to ignore the report.
