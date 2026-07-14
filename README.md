# HammaDev

**Persistent memory and handoff layer for AI coding agents.**

HammaDev reads a Codex CLI or Claude Code session and produces a compact,
structured handoff package another supported agent can pick up and continue
from — with no shared cloud service and no changes to the source agent's files.

> **Status:** v0.1-alpha. Local-only CLI. Codex ↔ Claude handoff.

---

## What problem does this solve?

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
- **Codex handoff skill.** `skills/hamma-handoff/` turns requests such as
  “continue this project from Claude Code” into a project-scoped, validated handoff.

---

## Demo flow

```bash
# 1. Install the CLI
npm install -g hammadev@alpha

# 2. Install the Codex skill, then restart Codex
hamma skill install

# 3. Get guided onboarding for your current project
hamma quickstart

# 4. See project status and session counts
hamma status

# 5. Hand off from Codex to Claude
hamma handoff codex:last --to claude

# 6. Hand off from Claude to Codex
hamma handoff claude:last --to codex
```

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
| `hamma skill install [--force]` | Install the packaged `hamma-handoff` skill into `$CODEX_HOME/skills` (or `~/.codex/skills`) and prompt for a Codex restart. |
| `hamma doctor` | Preflight check: Node version, `git` availability, Codex session presence, `projectPath` detection, and `.gitignore` safety. Exits non-zero on any failure. |
| `hamma status [--project <path>]` | Show a read-only overview for the current or selected project: Git state, handoff count/latest route, Codex and Claude session counts, and whether `.hamma/` is ignored. |
| `hamma list codex` | List Codex sessions found on this machine (newest first). |
| `hamma list claude [--project <path>] [--json]` | List Claude Code sessions without modifying them. With `--project`, rank project sessions by resumability and expose confidence, signals, and rejection reasons without transcript text. |
| `hamma inspect claude:last --shape` (also `claude:<sessionId>`) | **Experimental / read-only shape probe.** Reads a Claude Code `.jsonl` line-by-line and prints only structural stats — file size, line counts, top-level key frequency, `type`/role tallies, per-type field shapes, and any `cwd`/`projectPath` values. **No message text, prompt text, tool inputs, tool outputs, or file contents are ever printed.** Used to design the Claude parser without leaking session content. |
| `hamma inspect claude:<target> [--summary]` | **Experimental conservative parser (v0.1).** Normalizes a Claude session into `HammaSession`. Only visible user/assistant text messages are included — `system`, `permission-mode`, `mode`, `file-history-snapshot`, `ai-title`, `last-prompt`, and `attachment` records are ignored, and assistant `thinking`/`tool_use` and user `tool_result` blocks are dropped. All emitted message content passes through the same secret redaction used for Codex. No Claude files are modified. |
| `hamma inspect <target> [--summary]` | Print the normalized session as JSON. `<target>` accepts `codex:last`, `codex:<conversationId>`, `claude:last`, `claude:<sessionId>` (exact or unique prefix), a Codex rollout path, or an absolute UUID-named Claude session path. |
| `hamma handoff codex:<target> --to claude [--no-gitignore]` | Generate a Codex → Claude handoff under the source project's `.hamma/tasks/`. |
| `hamma handoff claude:<target> --to codex [--no-gitignore]` | Generate a Claude → Codex handoff under the Claude session's `projectPath`. The conservative parser excludes Claude internal/system/tool/thinking records. |
| `hamma handoff claude:project --to codex --project <path> --json` | Select the newest substantive Claude session belonging to the project, skipping trivial and terminal-auth-failure sessions, then emit a machine-readable artifact contract. |
| `hamma log [--project <path>]` | List local handoffs newest first for the current directory, or for the selected project. Shows task ID, agents, created time, `handoff.md` path, and the continue-from-here line when present. |
| `hamma show latest` | Print the newest local `handoff.md` from the current directory. |
| `hamma show <task-id>` | Print one local `handoff.md` by task ID from the current directory. |

In dev, invoke via `pnpm dev <command>`. The `bin` entry is `hamma`, so once
published/linked it can be invoked directly.

### Agent skill

The distributable Codex skill is in `skills/hamma-handoff/`. Once installed in an
agent host, a user can say “continue this project from Claude Code”; the skill
selects the project-scoped Claude session, validates the generated artifacts,
reconciles current Git state, and continues from the recorded next action.

Install the CLI and skill together, then restart Codex:

```bash
npm install -g hammadev@alpha && hamma skill install
```

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

## Safety model

- **Reads local agent session files:** Never modifies Codex rollout files or Claude session JSONL files.
- **Writes local `.hamma` handoff files:** Treats `.hamma/` as local scratch and auto-adds it to your `.gitignore`.
- **Redacts common secrets best-effort:** Scrubs common API-key shapes, but always review handoffs before sharing.
- **Does not upload data anywhere:** There is no network call, no backend, and no telemetry.
- **Does not print raw transcripts:** Commands like `quickstart`, `status`, `log`, and `show` will not leak your raw conversation history or source code to the terminal.

---

## Kiro Hook: Handoff Quality Guard

HammaDev includes a project-level [Kiro Hook](https://kiro.dev) that
automatically validates the handoff pipeline whenever source code changes.

### What it does

When Kiro saves a TypeScript file under `src/`, the hook runs a full
validation pipeline and generates a quality report at
`docs/generated/handoff-quality-report.md`.

The pipeline performs:

1. **Typecheck** - `pnpm typecheck` ensures type safety.
2. **Tests** - `pnpm test` confirms unit and integration tests pass.
3. **Build** - `pnpm build` compiles the project.
4. **Smoke test** - `node dist/cli.js --help` verifies the compiled CLI works.
5. **Component detection** - Identifies which HammaDev components are affected.
6. **Risk assessment** - Flags handoff-specific risks for affected components.

### Trigger scope

- **Triggers on:** TypeScript file saves matching `src/**/*.ts`
- **Does NOT trigger on:** Changes to `docs/generated/` (prevents recursive loops)

### Output

The report includes:

- Generation timestamp
- Changed source files
- Validation results with pass/fail status for each step
- Test totals (passed, failed, skipped)
- Command durations
- Overall pass/fail status
- Affected HammaDev components (Codex adapter, Claude adapter, handoff
  generation, task-state extraction, secret redaction, CLI commands,
  Git/project inspection, artifact rendering)
- Handoff-specific risks
- Recommended manual verification steps

### Manual invocation

```bash
pnpm quality:report
```

### Privacy

The generated report intentionally excludes:

- Session contents and raw transcripts
- Secrets and API keys
- Environment variable values
- Sensitive file contents

Only file paths, command names, and validation status are included.

---

## Current alpha limitations

- **Supported agents:** Currently only supports handoffs between Codex CLI and Claude Code.
- **Experimental parsing:** The Claude Code session parser is conservative and may drop some context (like tool uses or thinking blocks).
- **Local-only:** Handoffs are scoped to the current machine. There is no cloud syncing or shared team memory yet.
- **Best-effort redaction:** Secret redaction uses regex and may miss unstructured secrets or passwords.

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
