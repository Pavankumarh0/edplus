# EduPlus AI

**CBC 2.0 · PS-055 · Team TONY STARK**

Identify students who need academic support early, and track whether the
support actually worked.

---

## The idea in one paragraph

A deterministic engine decides **who** is at risk. Claude explains **why, and
what to do about it**. A human decides **whether to act**. Those three
responsibilities never blur — which is why, when a student asks "why was I
flagged?", the answer is a number, a threshold and a rule version, not a model
output.

---

## Quick start

```bash
npm install

# Secrets live in ONE file at the repo root, shared by every service.
cp .env.example .env.local        # then fill in the keys

# Everything on the local Firebase emulator — no credentials needed
npm run emulators                 # terminal A
npm run seed:emulator -- --april  # terminal B: 30 students, fully worked demo
npm run dev:voice                 # terminal C
npm run dev:emulator              # terminal D
```

Open **http://localhost:3000** and sign in as `faculty@eduplus.local` /
`eduplus-demo`.

> **Use `localhost`, not `127.0.0.1`.** Next 16 blocks cross-origin dev
> resources; on `127.0.0.1` the page renders but never hydrates, so every form
> looks dead.

To demo against the real project instead, drop `:emulator` from the commands.

---

## Layout

```
apps/web          Next.js — faculty dashboard + API routes
apps/mobile       Flutter — student app (Android)
packages/core     Zod schemas · risk engine · tool registry · repositories ·
                  design tokens · prompts   ← every business rule lives here
services/mcp      MCP server exposing the same tool registry
services/voice    Fastify — telephony webhooks, Sarvam speech, call simulator
firebase/         rules · indexes · seed · demo-reset
docs/             ARCHITECTURE · DESIGN · DEMO · SKILLS
sample-data/      demo CSVs
```

`packages/core` is the only place a business rule lives. The web app, the MCP
server and the voice service all import it; none re-implements scoring,
validation or permissions.

---

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | Typecheck everything, then run the unit tests |
| `npm test` | 196 unit tests (engine, CSV, tools, design tokens) |
| `npm run test:integration` | 48 tests against the Firestore emulator (rules + tool layer) |
| `npm run test:flutter` | 7 widget tests |
| `npm run check:contrast` | Asserts the palette's accessibility claims |
| `npm run seed[:emulator]` | Load the demo dataset (`-- --april` for the finished state) |
| `npm run demo:reset[:emulator]` | Empty the system, ready for a live upload |
| `npm run emulators` / `emulators:kill` | Firebase emulators (kill clears stale Java on Windows) |
| `npm run dev[:emulator]` | Dashboard |
| `npm run dev:voice[:emulator]` | Voice service + call simulator |
| `npm run dev:mcp[:emulator]` | MCP server (stdio) |
| `npm run rules:deploy` | Push Firestore rules and indexes |

---

## What is where

- **Risk engine** — `packages/core/src/risk`. Pure functions, no I/O. One
  linear band formula serves all four indicators. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §6.
- **Tool registry** — `packages/core/src/tools`. One definition per action,
  exposed both as MCP tools and to the in-app agents, each with an allowlist.
  Every call is Zod-validated, permission-checked and audited — including
  refusals.
- **Security rules** — `firebase/firestore.rules`, with 28 tests. Parent phone
  numbers live in a subcollection students are denied, because Firestore rules
  authorise documents, not fields.
- **Design system** — [`docs/design/DESIGN.md`](docs/design/DESIGN.md) is the
  prose; `packages/core/src/design/tokens.ts` is the machine-readable source
  that the Tailwind theme is generated from and the contrast test asserts
  against.

---

## Environment

Everything is read from `.env.local` at the repo root. Notable entries:

| Variable | Notes |
|---|---|
| `ANTHROPIC_MODEL` | Read from here and **nowhere else** — no model name is hard-coded |
| `VOBIZ_AUTH_ID` / `VOBIZ_AUTH_TOKEN` | Vobiz uses an id+token pair, not a single API key |
| `PUBLIC_BASE_URL` | Must be publicly reachable for real calls — Vobiz fetches the answer URL and the audio itself |
| `TELEPHONY_PROVIDER` | `simulated` (default) or `vobiz` |
| `FIRESTORE_EMULATOR_HOST` | Set by `.env.emulator`; makes the Admin SDK work with no credentials |

---

## Known constraints

- **`claude-sonnet-5-5` rejects forced `tool_choice` and assistant prefill.**
  Structured output shape comes from `output_config.format`, not a forced tool
  call. The structured-outputs endpoint also rejects `maxItems`/`minLength`, so
  the generated JSON Schema is stripped of them — the Zod schema still enforces
  the constraints on the way in.
- **Java 17** works today, but firebase-tools 15 will require JDK 21.
- `design-refs/` is empty; the design system was built from the brief's written
  direction.

---

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the design, the data model,
  the engine, and the verified Vobiz/Sarvam contracts
- [`docs/DEMO.md`](docs/DEMO.md) — the 5-minute script, with a failure playbook
- [`docs/design/DESIGN.md`](docs/design/DESIGN.md) — tokens, type, components
- [`docs/SKILLS.md`](docs/SKILLS.md) — what was installed, and what was
  rejected and why

**Out of scope:** Telegram bot, ESP32/IoT hardware, parent app.
