# HammaDev

**Persistent memory and handoff layer for AI coding agents.**

HammaDev reads a Codex CLI or Claude Code session and produces a compact,
structured handoff package another supported agent can pick up and continue
from — with no shared cloud service and no changes to the source agent's files.

> **Status:** v0.1-alpha. Local-only CLI. Codex ↔ Claude handoff.

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
- **Source adapter — Claude Code.** Discovers Claude JSONL sessions and conservatively parses visible user/assistant text while excluding internal, system, thinking, and tool records.
- **Handoff generator — targets `claude` and `codex`.** Produces a `.hamma/tasks/<id>/`
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
- **Project status.** Reports local Git state, handoff history, session counts,
  and `.hamma/` ignore coverage without printing transcripts.

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

# 4. Inspect the most recent Claude session
pnpm dev inspect claude:last --summary

# 5. Hand the Claude session to Codex (last, exact ID, or unique prefix)
pnpm dev handoff claude:last --to codex
pnpm dev handoff claude:aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa --to codex

# 6. List this project's local handoffs (newest first)
pnpm dev log

# 6b. List handoffs from another project
pnpm dev log --project /path/to/project

# 7. Print the latest or a specific handoff brief
pnpm dev show latest
pnpm dev show <task-id>

# 8. Show an overview for this project or another project
pnpm dev status
pnpm dev status --project /path/to/project
```

Handoffs are written under the source session's project directory as either
`.hamma/tasks/<timestamp>-codex-to-claude/` or
`.hamma/tasks/<timestamp>-claude-to-codex/`. The CLI then prints a suggested
command, for example:

```
codex "Read .hamma/tasks/<id>/handoff.md and continue the task from the current repo state."
```

---

## Install

Requires Node.js 22.12+ (Node 24 recommended).

Note: The npm package is named `hammadev`, but the CLI command is `hamma`.

```bash
npm install -g hammadev@alpha
```

Smoke test the installation:

```bash
hamma --help
hamma doctor
hamma quickstart
hamma status
```

## 2-Minute Quickstart

New to HammaDev? Run this command from any project directory to see what to do next:

```bash
hamma quickstart
```

It will detect your current project, check your environment, find your local Codex and Claude sessions, and give you the exact command you need to copy-paste to perform your first agent handoff.

## Dev setup

Requirements: Node.js 22.12+ and [pnpm](https://pnpm.io/) 10+.

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
| `hamma quickstart` | Guided read-only onboarding for first-time users. Shows project status and exact recommended next commands. |
| `hamma doctor` | Preflight check: Node version, `git` availability, Codex session presence, `projectPath` detection, and `.gitignore` safety. Exits non-zero on any failure. |
| `hamma status [--project <path>]` | Show a read-only overview for the current or selected project: Git state, handoff count/latest route, Codex and Claude session counts, and whether `.hamma/` is ignored. |
| `hamma list codex` | List Codex sessions found on this machine (newest first). |
| `hamma list claude` | List candidate Claude Code session files found under `~/.claude`, `~/.config/claude`, and `~/.local/share/claude`. Claude files are never modified. |
| `hamma inspect claude:last --shape` (also `claude:<sessionId>`) | **Experimental / read-only shape probe.** Reads a Claude Code `.jsonl` line-by-line and prints only structural stats — file size, line counts, top-level key frequency, `type`/role tallies, per-type field shapes, and any `cwd`/`projectPath` values. **No message text, prompt text, tool inputs, tool outputs, or file contents are ever printed.** Used to design the Claude parser without leaking session content. |
| `hamma inspect claude:<target> [--summary]` | **Experimental conservative parser (v0.1).** Normalizes a Claude session into `HammaSession`. Only visible user/assistant text messages are included — `system`, `permission-mode`, `mode`, `file-history-snapshot`, `ai-title`, `last-prompt`, and `attachment` records are ignored, and assistant `thinking`/`tool_use` and user `tool_result` blocks are dropped. All emitted message content passes through the same secret redaction used for Codex. No Claude files are modified. |
| `hamma inspect <target> [--summary]` | Print the normalized session as JSON. `<target>` accepts `codex:last`, `codex:<conversationId>`, `claude:last`, `claude:<sessionId>` (exact or unique prefix), a Codex rollout path, or an absolute UUID-named Claude session path. |
| `hamma handoff codex:<target> --to claude [--no-gitignore]` | Generate a Codex → Claude handoff under the source project's `.hamma/tasks/`. |
| `hamma handoff claude:<target> --to codex [--no-gitignore]` | Generate a Claude → Codex handoff under the Claude session's `projectPath`. The conservative parser excludes Claude internal/system/tool/thinking records. |
| `hamma log [--project <path>]` | List local handoffs newest first for the current directory, or for the selected project. Shows task ID, agents, created time, `handoff.md` path, and the continue-from-here line when present. |
| `hamma show latest` | Print the newest local `handoff.md` from the current directory. |
| `hamma show <task-id>` | Print one local `handoff.md` by task ID from the current directory. |

In dev, invoke via `pnpm dev <command>`. The `bin` entry is `hamma`, so once
published/linked it can be invoked directly.

---

## Generated files

Handoff artifacts are written under the *source project's* directory (the
project Codex or Claude was working in), not this repo:

```
<project>/.hamma/tasks/<ISO-timestamp>-<source>-to-<target>/
├── handoff.md            # short markdown brief for the target agent
├── state.json            # structured task state
├── session.json          # full normalized session
├── timeline.md           # importance-filtered chronological view
├── commands.md           # bucketed shell/tool command summary
└── redaction-report.md   # secret-redaction summary
```

By default, HammaDev appends `.hamma/` to that project's `.gitignore` so
handoff artifacts stay local. Pass `--no-gitignore` to skip.

`hamma status`, `hamma log`, and `hamma show` are read-only. Status reads only
project/Git metadata plus handoff or state metadata; these commands do not
print `session.json` or raw transcript data.

---

## Security model

- **Local only.** All parsing, redaction, and file writes happen on your
  machine. There is no network call, no backend, no telemetry.
- **Read-only against source sessions.** HammaDev never modifies Codex rollout
  files or Claude session JSONL files.
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

- Additional source adapters: Gemini CLI, opencode, Antigravity.
- Richer task-ledger extraction (fewer parser warnings, better dedup).
- More history filters and handoff retention controls.

Later:

- Optional backend for cross-machine handoff and team-shared memory.
- Durable storage layer (CockroachDB) for multi-user deployments.
- Editor / IDE integrations.

Backend and CockroachDB are intentionally **not** part of the alpha — the
current design is a local CLI you can audit end-to-end.

---

## License

ISC. See `package.json`.
