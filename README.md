# HammaDev

**Persistent memory and handoff layer for AI coding agents.**

HammaDev reads a coding-agent session (currently OpenAI Codex CLI) and produces a
compact, structured handoff package another agent (currently Claude Code) can
pick up and continue from — with no shared cloud service and no changes to the
source agent's files.

> **Status:** v0.1-alpha. Local-only CLI. Codex → Claude handoff.

---

## The problem

Each AI coding CLI keeps its own conversation history in its own format.
When you switch agents mid-task — because you hit a context limit, want a
second opinion, or one tool is better at the next step — the new agent has
no idea what has already been tried, decided, or ruled out.

You either:

- Re-paste large chunks of the previous transcript by hand, or
- Give a vague "continue from before" prompt and watch the new agent
  redo work that's already done.

HammaDev is a small tool that reads the source agent's native session file,
extracts what actually matters (goal, task ledger, verification signals,
current repo state, known risks), redacts obvious secrets, and writes a
short `handoff.md` plus supporting artifacts to a local `.hamma/` directory
in your project. The next agent reads that file and continues.

---

## Current alpha capabilities

- **Source adapter — Codex CLI.** Discovers rollouts under
  `~/.codex/sessions/**/rollout-*.jsonl` and parses them into a normalized
  `HammaSession` model.
- **Handoff generator — target `claude`.** Produces a `.hamma/tasks/<id>/`
  directory containing:
  - `handoff.md` — a size-guarded (~15 KB target, 20 KB hard cap) markdown
    brief with next action, current state, completed vs. remaining tasks,
    verification signals, `git status --short` / `git diff --stat`, and
    known risks.
  - `state.json` — the structured task state the markdown was rendered from.
  - `session.json` — the full normalized session (for archival / debugging).
  - `timeline.md` — an importance-filtered chronological view.
  - `commands.md` — bucketed summary of shell/tool invocations observed.
  - `redaction-report.md` — count and warnings from secret redaction.
- **Secret redaction.** Regex-based scrub of common API-key shapes
  (OpenAI, Anthropic, GitHub, Google, Slack, generic `api_key=...`).
- **Non-destructive.** Never writes to the source agent's session files.
  Optionally appends `.hamma/` to your project's `.gitignore`.

---

## Demo flow

```bash
# 1. See what Codex sessions exist on this machine
pnpm dev list codex

# 2. Inspect the most recent Codex session (summarized JSON)
pnpm dev inspect codex:last --summary

# 2b. Inspect a specific session by conversationId (exact or unique prefix)
pnpm dev inspect codex:019f18df-4e55-73a1-91d9-83551639edbf --summary

# 2c. Inspect a rollout file directly by path
pnpm dev inspect /home/you/.codex/sessions/2026/06/30/rollout-2026-06-30T14-22-05-019f18df-4e55-73a1-91d9-83551639edbf.jsonl --summary

# 3. Create a handoff package for Claude Code to pick up
pnpm dev handoff codex:last --to claude

# 3b. Same, but selecting a specific session
pnpm dev handoff codex:019f18df-4e55-73a1-91d9-83551639edbf --to claude
```

The last command writes `.hamma/tasks/<timestamp>-codex-to-claude/` inside
the project directory Codex was working in, and prints a suggested next
command, e.g.:

```
claude "Read .hamma/tasks/<id>/handoff.md and continue the task from the current repo state."
```

---

## Install / dev setup

Requirements: Node.js 20+ and [pnpm](https://pnpm.io/) 10+.

```bash
git clone https://github.com/<you>/hammadev.git
cd hammadev
pnpm install

# Run the CLI directly via tsx (no build step needed for dev)
pnpm dev --help
```

Typecheck:

```bash
pnpm typecheck
```

Build the compiled JS (`dist/`):

```bash
pnpm build
```

---

## Commands

| Command | Purpose |
| --- | --- |
| `hamma doctor` | Preflight check: Node version, `git` availability, Codex session presence, `projectPath` detection, and `.gitignore` safety. Exits non-zero on any failure. |
| `hamma list codex` | List Codex sessions found on this machine (newest first). |
| `hamma inspect <target> [--summary]` | Print the parsed session as JSON. `--summary` truncates and shows head/tail. `<target>` is `codex:last`, `codex:<conversationId>` (exact or unique prefix), or a rollout `.jsonl` file path. |
| `hamma handoff <target> --to claude [--no-gitignore]` | Write a handoff package under `.hamma/tasks/`. `<target>` accepts the same forms as `inspect`. `--no-gitignore` skips the `.gitignore` update. |

In dev, invoke via `pnpm dev <command>`. The `bin` entry is `hamma`, so once
published/linked it can be invoked directly.

---

## Generated files

Handoff artifacts are written under the *source project's* directory (the
project Codex was working in), not this repo:

```
<project>/.hamma/tasks/<ISO-timestamp>-codex-to-claude/
├── handoff.md            # short markdown brief for the target agent
├── state.json            # structured task state
├── session.json          # full normalized session
├── timeline.md           # importance-filtered chronological view
├── commands.md           # bucketed shell/tool command summary
└── redaction-report.md   # secret-redaction summary
```

By default, HammaDev appends `.hamma/` to that project's `.gitignore` so
handoff artifacts stay local. Pass `--no-gitignore` to skip.

---

## Security model

- **Local only.** All parsing, redaction, and file writes happen on your
  machine. There is no network call, no backend, no telemetry.
- **Read-only against source sessions.** HammaDev never modifies rollout
  files under `~/.codex/sessions/`.
- **Best-effort secret redaction.** Common API-key patterns (OpenAI,
  Anthropic, GitHub, Google, Slack, generic `key/token/secret/password = …`)
  are replaced with `[REDACTED_SECRET]` in the emitted artifacts, and
  counted in `redaction-report.md`. Redaction is regex-based and is *not*
  a substitute for reviewing the handoff before sharing it.
- **System / developer prompts omitted** from the handoff brief; the full
  transcript still lives in `session.json` for local inspection.
- **`.hamma/` is treated as local scratch.** It is gitignored in this repo
  and auto-added to the source project's `.gitignore` on handoff.

---

## Roadmap

Near-term:

- Additional source adapters: Claude Code, Gemini CLI, opencode, Antigravity.
- `claude → codex` and other reverse handoffs.
- Richer task-ledger extraction (fewer parser warnings, better dedup).
- Per-project handoff history / `hamma log`.

Later:

- Optional backend for cross-machine handoff and team-shared memory.
- Durable storage layer (CockroachDB) for multi-user deployments.
- Editor / IDE integrations.

Backend and CockroachDB are intentionally **not** part of the alpha — the
current design is a local CLI you can audit end-to-end.

---

## License

ISC. See `package.json`.
