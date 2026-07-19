<p align="center">
  <img src="docs/assets/hammadev-mark.svg" width="88" height="88" alt="HammaDev logo" />
</p>

<h1 align="center">HammaDev</h1>

<p align="center">
  <strong>Persistent, local task memory for AI coding agents.</strong><br />
  Switch between Codex, Claude Code, and Grok without losing the actionable state of your work.
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

HammaDev discovers project-related coding sessions, reconstructs the task state,
and gives the next agent a compact continuation contract: what is complete, what
remains, what was verified, which files matter, what changed in Git, what could
be stale, and exactly what to do next.

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
| Persistent named memory | One stable task identity across several Codex, Claude Code, or Grok sessions. |
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

### Continue the best available session

```bash
# Preview the selection decision without writing a handoff.
hamma continue --to codex --explain

# Create the handoff and print the exact Codex continuation command.
hamma continue --to codex
```

Both paths reconstruct the latest substantive task epoch before continuing.
If that epoch is already complete, blocked, ambiguous, or not ready, HammaDev
prints an explainable no-op/review recommendation and creates no handoff. Use
`--force` only when you intentionally want an inspection artifact; completed
work still receives no agent-launch command.

### Keep a named development thread

```bash
# Create one stable project-owned identity.
hamma memory start build-week --goal "Ship the Build Week release"

# Work normally, then checkpoint the exact current session.
hamma memory sync --source codex:current

# Inspect current state, live Git drift, and readiness.
hamma memory show build-week

# Switch agents without re-explaining the task.
hamma memory resume build-week --to claude
```

After `memory start`, the active memory is project-scoped, so ordinary
`hamma memory sync` calls do not need the name again. Each successful sync
creates an immutable revision; it does not overwrite earlier task state.
`memory resume` similarly withholds an automatic launch for completed or unsafe
state and reports `resumeAllowed` in JSON.

## The continuation flow

```text
Codex session A ─┐
Claude session B ├─> HammaSession ─> HammaTaskState ─> compact handoff
Grok session C  ─┘                         │
                                            └─> memory:build-week
                                                revision 1 → 2 → 3
```

1. Agent-specific adapters read native sessions without modifying them.
2. HammaDev normalizes each source into one `HammaSession` model.
3. Task extraction reconstructs goals, ledger state, verification, evidence,
   risks, files, Git metadata, and the next action.
4. The handoff records a repository snapshot and an explainable readiness result.
5. The receiving agent reconciles the handoff with live Git state before editing.

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

Named memories store smaller immutable revisions:

```text
.hamma/memories/
├── active.json
└── build-week/
    ├── memory.json
    └── revisions/<revision-id>/
        ├── state.json
        ├── handoff.md
        ├── tool_history.jsonl    # bounded archive-only diagnostics
        └── revision.json
```

Full transcripts are not copied into named-memory revisions. Receiving agents
load only `handoff.md` initially; `state.json` is optional supporting context,
and diagnostic/archive artifacts are not preloaded.

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
| `hamma continue --to <agent> [--explain] [--force]` | Select the strongest cross-agent project session, preflight its current task epoch, and create a continuation only when actionable. |
| `hamma handoff <agent>:<session> --to <agent>` | Create a handoff from an explicitly selected source session. |
| `hamma memory start <name> [--goal <text>]` | Create and activate a named project memory. |
| `hamma memory sync [name] [--source <target>]` | Append an immutable revision from a selected or automatically discovered session. |
| `hamma memory list` | List project memories and their active/latest state. |
| `hamma memory show [name]` | Show latest task state, drift, and readiness. |
| `hamma memory resume [name] --to <agent>` | Activate a memory and print the exact target-agent continuation command. |
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

Skills are advisory/model-driven. For deterministic checkpoints, use explicit
`hamma memory sync` or configure a trusted native lifecycle hook. Codex supports
a useful `PreCompact` checkpoint; Claude Code and Grok also document
`SessionEnd`. Hooks remain opt-in and cannot guarantee a final sync after a
crash or killed process.

See [named-memory hook recipes and limitations](docs/memory-hooks.md).

## Architecture

HammaDev keeps native formats at the edge and one universal state model at the
center:

- **Adapters:** `src/adapters/{codex,claude,grok}/` own native storage and parsing.
- **Normalized session:** every adapter emits `HammaSession`.
- **Universal task state:** `HammaTaskState` powers handoffs and named memories.
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
```

The CLI is strict TypeScript and ESM. Tests use synthetic sessions and temporary
Git repositories. CI validates Node 22.12 and Node 24.

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
