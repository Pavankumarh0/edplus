# Installed skills

What is in `.claude/skills/`, why, and what was deliberately left out.

Source: [anthropics/skills](https://github.com/anthropics/skills) @ `dbd4588`
(shallow clone, 2026-10-10).

---

## Installed

| Skill | Why we installed it | Ships scripts? |
|---|---|---|
| **mcp-builder** | Building `services/mcp`. Carries reference docs for the Node/TypeScript MCP SDK (`reference/node_mcp_server.md`) and an evaluation harness for checking the tool surface is actually usable by a model. | Yes — `connections.py`, `evaluation.py` |
| **frontend-design** | UI quality for the faculty dashboard and the student app. Pushes for deliberate, non-templated visual choices, which is exactly the risk with a bento-card dashboard built fast. | No |
| **webapp-testing** | Playwright click-through of the demo flow before calling the work done, per the quality bar. | Yes — `scripts/with_server.py` |

### Script audit

The brief says never install an unread script, so all three were read before
installing:

- `webapp-testing/scripts/with_server.py` — uses `subprocess` to launch the dev
  server named on its command line and `socket` to poll the port until it
  answers. No network fetches, no `eval`/`exec`, no destructive filesystem
  calls. Does what it claims.
- `mcp-builder/scripts/connections.py` and `evaluation.py` — no network, exec or
  filesystem write surface at all; they drive the `mcp` and `anthropic`
  libraries. `requirements.txt` is just `anthropic>=0.39.0` and `mcp>=1.1.0`.
- One caveat: `webapp-testing/examples/console_logging.py` writes to
  `/mnt/user-data/outputs/`, a Linux path that does not exist on this Windows
  machine. It is an example, not a helper — adapt the path if you run it.

---

## Deliberately not installed

The brief asked for the most-starred Claude Code skills for (a) voice/telephony
agents and (b) agent building. Two findings:

**1. `gh` is not installed on this machine**, so `gh search repos` was not
available. Searched the web instead. If you install the GitHub CLI later, the
search is worth repeating.

**2. Nothing found was both relevant and safe.** The voice/telephony skills that
surfaced — `abracadabra50/claude-code-voice-skill`, `Anil-matcha/AI-Voice-Agent`,
`VoiceMode Connect`, a Retell AI template — all solve the *opposite* problem:
they let a developer talk to Claude Code over a phone or microphone. We are
building an outbound-calling agent that phones parents through Vobiz. Installing
them would add unread third-party code to the repo for no benefit.

The broad collections (`ComposioHQ/awesome-claude-skills`,
`laolaoshiren/claude-code-skills-zh`) are indexes of other people's skills, not
skills themselves.

Per the brief's instruction to install only what is *clearly* relevant and safe,
nothing from that search was installed. The agent-building guidance we actually
needed came from the bundled `claude-api` skill, which carries the current
model IDs and the Anthropic TypeScript SDK tool-use patterns.

---

## Skill-adjacent knowledge that mattered more

Two things shaped the code more than any installed skill, both verified from
live docs rather than memory:

- **`claude-sonnet-5-5` rejects forced tool use** (`tool_choice: any|tool` →
  HTTP 400) **and assistant prefill**. So the Report Agent guarantees its JSON
  shape with `output_config.format` (structured outputs), not by forcing a
  `save_report` call. See `docs/ARCHITECTURE.md` §7.
- **Vobiz and Sarvam contracts** were read from their own documentation, and
  two brief-level assumptions turned out wrong: Vobiz authenticates with an
  auth-id + auth-token pair (not a single `VOBIZ_API_KEY`), and Sarvam's TTS
  field is `language_code`, not `target_language_code`. Sarvam's `saarika`
  model is deprecated — `saaras:v4` is current.
