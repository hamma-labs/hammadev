<p align="center">
  <img src="docs/assets/hammadev-mark.svg" width="88" height="88" alt="HammaDev logo" />
</p>

<h1 align="center">HammaDev</h1>

<p align="center">
  <strong>Persistent, local repository memory for AI coding agents.</strong><br />
  Switch between Codex, Claude Code, and Grok without losing decisions, constraints, discoveries, or task history.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hammadev"><img src="https://img.shields.io/npm/v/hammadev?color=7257e8&label=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A522.12-b9df79" alt="Node.js 22.12 or newer" />
  <img src="https://img.shields.io/badge/agents-Codex%20%C2%B7%20Claude%20%C2%B7%20Grok-f06f52" alt="Codex, Claude Code, and Grok" />
  <img src="https://img.shields.io/badge/local--only-no%20telemetry-17202a" alt="Local-only with no telemetry" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-ISC-f6f4ef" alt="ISC license" /></a>
</p>

<p align="center">
  <img src="docs/assets/hammadev-memory-hero.png" width="1100" alt="Three coding-agent sessions connected through a persistent project memory" />
</p>

> **Sessions belong to agents. Memory belongs to the project.**

HammaDev discovers project-related coding sessions and builds layered repository
memory: durable knowledge, immutable task epochs, sanitized conversation deltas,
and a compact bootstrap. Completed work stops automatic execution but remains
available as context for the project's next request.

It never renames or modifies native agent sessions. There is no cloud backend,
account, telemetry, or transcript upload.

## Why HammaDev?

Pasting an entire transcript transfers volume, not trustworthy state. The next
agent still has to work out which claims are current, whether tests passed, and
whether the repository has moved on.

HammaDev turns that history into an evidence-aware execution contract:

| Capability | What the receiving agent gets |
| --- | --- |
| Intelligent continuation | The strongest resumable session for the current Git project, selected and explained. |
| Persistent repository memory | A project default plus optional named threads, with durable knowledge and provenance. |
| Immutable task epochs | Independent outcomes across successive tasks, without merging reused task IDs into unrelated later work. |
| Local lexical recall | Bounded exact-phrase, file-path, fact, and recency search without a network or embedding service. |
| Evidence provenance | Agent claims distinguished from commands, repository evidence, tool evidence, and user confirmation. |
| Git reconciliation | Recorded HEAD, branch, working-tree state, relevant-file digests, and explainable drift. |
| Readiness assessment | `ready`, `review_recommended`, or `not_ready`, with concrete signals and blockers. |
| Context benchmark | Source-session size compared honestly with the effective continuation artifacts. |

The core rule is deliberately simple:

> When a handoff conflicts with the live repository, trust the repository.

## Quick start

HammaDev requires Node.js 22.12 or newer.

```bash
npm install -g hammadev@alpha

cd /path/to/project
hamma
```

Running `hamma` with no subcommand performs guided, read-only onboarding. It
checks the runtime, Git project, supported agent installations, project sessions,
and `.hamma/` ignore coverage, then prints the safest next command.

### The everyday workflow

```bash
# Save whatever you are doing now. Hamma detects the current agent.
hamma save

# Save and move the task. In an interactive terminal, Claude opens automatically.
hamma switch claude

# In the receiving agent, save a checkpoint or close the work.
hamma save
hamma done

# Ask the project memory a question.
hamma ask "why did we choose sqlite"

# Optional: make it automatic. Installs native agent hooks so memory
# checkpoints on supported lifecycle events and loads at session start.
hamma hooks install

# Codex: also checkpoint on normal exit, Ctrl-C, or child-process failure.
hamma codex
```

That is the complete normal workflow. Hamma detects the current project session,
creates the default memory, remembers the active task claim, generates the
bounded context, and closes the correct task epoch. If two agents are active at
the same time, it stops and asks for a single hint such as
`hamma save --agent codex` instead of guessing.

The lower-level `hamma memory ...`, `handoff`, and `continue` commands remain
available for scripts, hooks, named threads, inspection, and debugging. They are
not required for ordinary use.

If these commands are newer than the npm alpha currently installed, run the
checkout directly while developing:

```bash
corepack pnpm install
corepack pnpm dev -- switch claude --no-launch
```

## The continuation flow

```text
Codex session A ─┐                     ┌─> durable knowledge + provenance
Claude session B ├─> HammaSession ─────┼─> independent task epochs
Grok session C  ─┘                     ├─> sanitized conversation deltas
                                       └─> bounded bootstrap.md
```

1. Agent-specific adapters read native sessions without modifying them.
2. HammaDev normalizes each source into one `HammaSession` model.
3. Capture merges durable knowledge by normalized identity while retaining
   provenance and independent epoch outcomes.
4. A bounded bootstrap prioritizes current state, important facts, and recent epochs.
5. Attach chooses an execution mode and the receiving agent reconciles memory
   with live Git before editing.

![Generated HammaDev handoff with execution contract, next action, completed work, and verification](docs/assets/handoff.svg)

## What gets generated?

One-off handoffs are written atomically under the source project:

```text
.hamma/tasks/<timestamp>-<source>-to-<target>/
├── handoff.md            # compact agent execution contract
├── state.json            # versioned HammaTaskState
├── tool_history.jsonl    # bounded archive-only tool diagnostics
├── session.json          # normalized local archive
├── timeline.md           # importance-filtered chronology
├── commands.md           # command summary
└── redaction-report.md   # best-effort redaction report
```

Repository memories store immutable v2 revisions:

```text
.hamma/memories/
├── active.json
└── build-week/
    ├── memory.json
    └── revisions/<revision-id>/
        ├── bootstrap.md          # bounded default agent context
        ├── memory-state.json     # durable knowledge and task epochs
        ├── state.json            # latest task state compatibility
        ├── handoff.md            # legacy task-oriented artifact
        ├── conversation.jsonl    # sanitized user/assistant delta
        ├── tool_history.jsonl    # bounded archive-only diagnostics
        └── revision.json
```

System messages and complete raw tool output are excluded. Receiving agents load
only `bootstrap.md` initially. Bootstrap plus launch prompt is capped at 8 KiB;
deeper structured facts and archived messages remain available through recall.

## Inspect before continuing

```bash
# Compare the recorded Git snapshot with the live repository.
hamma show latest --check-drift

# Explain whether another agent has enough trustworthy state to continue.
hamma show latest --check-drift --readiness

# Compare source context with the bounded initial continuation context.
hamma benchmark latest
```

All applicable commands support structured `--json` output. Human diagnostics
and structured logs stay off stdout, so JSON consumers remain safe.

## Command map

| Command | Purpose |
| --- | --- |
| `hamma` | Guided project diagnosis and exact next step. |
| `hamma save [--agent <agent>]` | Detect and save the current session, or checkpoint the active transferred run. |
| `hamma switch <agent>` | Save current work, prepare safe context, and open the destination agent. |
| `hamma done [--blocked --next <text>]` | Save and close the current task without exposing attach IDs or update files. |
| `hamma ask <question>` | Search the active project memory in plain language. |
| `hamma continue --to <agent> [--explain] [--force]` | Select the strongest cross-agent project session, preflight its current task epoch, and create a continuation only when actionable. |
| `hamma handoff <agent>:<session> --to <agent>` | Create a handoff from an explicitly selected source session. |
| `hamma memory start <name> [--goal <text>]` | Create and activate a named project memory. |
| `hamma memory sync [name] --source <target> [--update-file <path>]` | Append an immutable v2 revision from an exact session; first explicit use creates `default`. |
| `hamma memory list` | List project memories and their active/latest state. |
| `hamma memory show [name]` | Show latest task state, drift, and readiness. |
| `hamma memory attach [name] --to <agent> [--source <target>] [--no-sync]` | Load the frozen bootstrap, optionally sync an exact source first, and claim actionable work. |
| `hamma memory checkpoint [name] --attach <id> --source <target> [--update-file <path>]` | Advanced: write a milestone into the claimed task epoch. |
| `hamma memory finish [name] --attach <id> --source <target> [--update-file <path>]` | Advanced: write back and close the claimed task epoch. |
| `hamma memory abandon [name] --attach <id> --reason <text>` | Release a claim without changing the stored task state. |
| `hamma memory recall [name] --query <text> [--limit <n>]` | Search structured facts and sanitized messages locally. |
| `hamma memory resume [name] --to <agent>` | Compatibility alias for attach with legacy paths and `resumeAllowed`. |
| `hamma list <codex\|claude\|grok>` | List discovered native sessions. |
| `hamma inspect <target> [--summary]` | Inspect one normalized session. |
| `hamma status [--project <path>]` | Show project Git state, sessions, handoffs, and ignore safety. |
| `hamma log` / `hamma show <task-id>` | Browse local handoff history. |
| `hamma benchmark <task-id\|latest>` | Measure source and continuation artifact sizes transparently. |
| `hamma skill install [--force]` | Install the packaged handoff, snapshot, and resume skills. |
| `hamma doctor` | Validate runtime, Git, discovery, and local safety assumptions. |

Use `hamma <command> --help` for every option and target form.

## Agent skills and optional checkpoints

HammaDev ships three reusable agent workflows:

- `hamma-handoff` — transfer work to another supported agent.
- `hamma-snap` — checkpoint the exact current session.
- `hamma-resume` — resume a one-off handoff or named memory.

Install them with:

```bash
hamma skill install
```

Skills are advisory/model-driven. They use the same `hamma save`, `switch`, and
`done` interface while keeping exact-source and attach-claim mechanics internal.
Codex uses native `PreCompact` and `SessionStart` hooks to checkpoint before
compaction and load bounded memory context on startup, resume, clear, and after
compaction. Launching it through `hamma codex -- [Codex arguments]` adds an
exact-session exit checkpoint. If the wrapper is interrupted too, a persistent
per-launch record is recovered at the next agent session start. Claude Code and
Grok also document `SessionEnd`. Hooks remain opt-in; no local tool can preserve
transcript bytes that never reached disk.

See [named-memory hook recipes and limitations](docs/memory-hooks.md).

## Architecture

HammaDev keeps native formats at the edge and one universal state model at the
center:

- **Adapters:** `src/adapters/{codex,claude,grok}/` own native storage and parsing.
- **Normalized session:** every adapter emits `HammaSession`.
- **Layered state:** `HammaTaskState` powers one-off handoffs while
  `HammaMemoryState` adds durable knowledge, provenance, cursors, and epochs.
- **Evidence-aware core:** provenance, Git snapshots, drift, readiness, and
  quality ranking are shared rather than reimplemented per agent.
- **Target-neutral artifacts:** the same contract works for Codex, Claude Code,
  Grok, and future consumers.

Adding another agent should require a new input adapter—not a new task schema.

## Local-first security model

The HammaDev CLI makes no network calls and does not modify native session
files, but local-only does not mean risk-free:

- Redaction is best effort and can miss unusual or fragmented secrets.
- `session.json`, task text, commands, tool output, and memory revisions may be
  sensitive even after normalization.
- Session content is untrusted input; a prompt injection can survive as task
  context and must not override the execution contract.
- `.gitignore` reduces accidental commits but is not access control.
- Parsing, task extraction, session ranking, and readiness are conservative
  heuristics—not guarantees.
- Path validation, symlink protection, size limits, and atomic writes reduce
  exposure without making hostile content safe.

Keep `.hamma/` local, inspect artifacts before sharing, and reconcile every
handoff with the repository.

## Synthetic examples and docs

- [Generated Codex → Claude handoff](examples/generated/codex-to-claude/)
- [Sanitized source-session fixtures](examples/sessions/)
- [Example-data notes](examples/README.md)
- [Named-memory hooks](docs/memory-hooks.md)
- [Release automation](docs/releasing.md)
- [Troubleshooting](docs/troubleshooting.md)
- [OpenAI Build Week engineering log](docs/build-week-2026.md)

No committed example contains a real user session or credential.

## Development

Requirements: Node.js 22.12+ and pnpm 10.15+.

```bash
git clone https://github.com/xayrullonematov/hammadev.git
cd hammadev
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:cli
pnpm smoke:package
```

The CLI is strict TypeScript and ESM. Tests use synthetic sessions and temporary
Git repositories. `smoke:package` packs and installs the actual npm tarball in a
temporary environment, then checks completed/no-op and actionable/bounded
continuation paths. CI validates Node 22.12 and Node 24.

The optional project-level Kiro quality hook runs `pnpm quality:report` after
TypeScript source saves and records a local, content-safe validation report. See
[the hook notes](.kiro/hooks/handoff-quality-guard.md).

## Current alpha boundaries

- Codex, Claude Code, and Grok are the supported native source adapters.
- Task reconstruction, evidence classification, and redaction remain heuristic.
- Named-memory hooks are opt-in; explicit sync is the portable fallback.
- Memory is project-local on one machine; there is no cloud or team backend.
- The readiness result helps a developer decide whether to continue—it does not
  guarantee that another agent will succeed.

## Build Week provenance

HammaDev existed before OpenAI Build Week. The event work added intelligent
cross-agent continuation, versioned Git drift detection, evidence provenance,
explainable readiness, transparent context benchmarking, and persistent named
project memory. The exact baseline, design decisions, verification results, and
commits are recorded in [the Build Week log](docs/build-week-2026.md).

## License

[ISC](LICENSE)
