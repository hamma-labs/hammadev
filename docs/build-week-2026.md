# OpenAI Build Week 2026

This document separates HammaDev's pre-event baseline from improvements made
during the July 18–20, 2026 Build Week sprint. It is an engineering log, not a
claim that the existing project was created during the event.

## Baseline before Build Week

The repository entered the sprint at `b18b6e7` (July 14, 2026). It already had:

- local discovery and normalization for Codex, Claude Code, and Grok sessions;
- project-scoped Codex and Claude session selection using a shared resumability
  score, including rejection of Hamma self-handoff sessions;
- a universal task-state and handoff format with completed/remaining work,
  verification summaries, risks, referenced files, Git status, and diff stat;
- atomic local artifact writes, best-effort redaction, session size limits,
  traversal and symlink protections, and machine-readable CLI modes;
- agent skills for handoff, same-agent resume, and snapshot workflows.

The main missing product workflow was automatic selection across source agents:
users still had to know whether to run `claude:project`, `codex:project`, or
`grok:project`.

## Build Week work

### Day 1 — intelligent continuation

- Implemented `hamma continue --to <agent>` to rank project sessions across
  supported source agents, exclude the destination source by default, explain
  the decision, and create the normal handoff package.
- Implemented Grok project selection using the existing shared quality
  scorer instead of newest-session-only selection.

### Day 1 — versioned Git snapshot and drift detection

- Added a compact Git snapshot to `state.json`: HEAD, branch/detached state,
  staged, unstaged, and untracked file lists, changed-file and referenced-file
  digests, and a deterministic metadata fingerprint.
- Added `hamma show <task-id> --check-drift` plus structured `--json` output.
  Comparisons explain HEAD, branch, working-tree, untracked-file, and relevant
  file differences without storing source contents or full diffs.
- Git drift matters because a handoff is historical context: another agent may
  commit, switch branches, or edit task-relevant files before the receiving
  agent loads it. The live repository remains authoritative.

### Day 1 — evidence provenance

- Added additive provenance-tagged evidence to `state.json`, distinguishing
  source-agent claims, verification commands, repository snapshots, other tool
  observations, and narrow user confirmations.
- Explicit command exit codes produce passed/failed evidence. Commands without
  an outcome remain observed, and assistant prose is never promoted above
  claimed evidence.
- Added a compact provenance summary to `handoff.md` while retaining the
  existing verification strings for schema-v1 consumers.

### Day 2 — explainable handoff readiness

- Added deterministic readiness levels: `ready`, `review_recommended`, and
  `not_ready`. No numeric score is used because the available signals support
  categorical safety decisions more honestly than probability-like precision.
- Readiness evaluates actionability, evidence quality, verification outcomes,
  repository snapshot and live drift, risk/blocker clarity, and context
  completeness. Failed verification, blocked work, and ambiguous or missing
  continuation state are critical overrides.
- Added `hamma show <task-id> --readiness [--json]`. New handoff results and
  `state.json` also include an additive readiness-at-creation result; live
  `show` assessments are recomputed against the current repository.
- Evidence provenance made readiness possible: assistant claims can now be
  treated differently from passed commands, repository observations, tool
  evidence, and user confirmation.

Readiness is a deterministic heuristic to help a developer decide whether to
continue or review a handoff. It is not a probability, a guarantee of agent
success, or a substitute for inspecting the repository. Older handoffs without
provenance or snapshots are assessed conservatively rather than rejected.

## Architectural decisions

- Reuse `scoreSession` and `rankCandidates`; do not introduce a competing
  cross-agent ranking formula.
- Keep native parsing inside adapters. Cross-agent orchestration consumes only
  normalized `SessionCandidate` and `HammaSession` values.
- Make explain/dry-run read-only and keep JSON stdout free of human logs.
- Keep the outer handoff schema at version 1 by adding an optional versioned
  `repoState.snapshot`. Handoffs created before this field existed remain
  readable and report that recorded repository metadata is unavailable.
- Build the fingerprint from safe, sorted Git metadata and file digests. It is
  a deterministic comparison aid, not cryptographic proof of repository
  identity or history.
- Allow readiness blockers to override otherwise strong signals. Repository
  drift produces explainable review warnings instead of being hidden inside a
  combined score.

## Codex contributions

- Repository and Git-history audit identifying the existing project-aware
  ranking, state extraction, handoff, and safety boundaries.
- Cross-agent continuation orchestration, shared Grok ranking, dry-run JSON UX,
  and focused unit/CLI tests.
- Git snapshot data model, deterministic comparison, drift rendering, tolerant
  old-handoff reads, synthetic Git repositories, and CLI integration tests.
- Evidence taxonomy, conservative command-outcome extraction, repository/tool/
  user evidence handling, compatibility-preserving rendering, and focused tests.
- Readiness dimensions, categorical override rules, live drift integration,
  old-handoff tolerance, stable JSON output, and deterministic test coverage.

## Verification log

- Baseline commands attempted July 18: `pnpm typecheck`, `pnpm test`,
  `pnpm build`, and `pnpm smoke:cli`.
- Environment result: commands did not start because this shell initially had
  Node 18.19.1, no pnpm/Corepack, and no installed dependencies. This is not
  recorded as a passing or failing repository baseline.
- After provisioning the pinned toolchain locally: TypeScript typecheck passed,
  build and compiled CLI smoke passed, and 199 tests passed across 32 files.
- Git snapshot milestone: targeted drift tests passed (32 tests across 4 files),
  full typecheck passed, the full suite passed (210 tests across 33 files), build
  passed, compiled CLI smoke passed, and `git diff --check` passed.
- Evidence provenance milestone: 31 targeted tests across 3 files passed, full
  typecheck passed, the full suite passed (215 tests across 34 files), build and
  compiled CLI smoke passed, and `git diff --check` passed.
- Readiness milestone: 44 targeted tests across 4 files passed, full typecheck
  passed, the full suite passed (232 tests across 35 files), build and compiled
  CLI smoke passed, and `git diff --check` passed.
- `graphify update .` was attempted after the code change, but the `graphify`
  executable is not installed in this environment and no graph output exists.

## Build Week commits

- `cd58f0a` — `feat: add intelligent cross-agent continuation`
- `97b8079` — `feat: detect repository drift in handoffs`
- `bf62f75` — `feat: add evidence provenance to handoffs`
- `2364711` — `feat: assess handoff readiness`

## Demo flow (target)

```bash
cd /path/to/project
hamma continue --to codex --explain
hamma continue --to codex
hamma show latest --check-drift
hamma show latest --check-drift --json
hamma show latest --readiness
hamma show latest --check-drift --readiness --json
```

The first command should show the winning source session and selection signals
without writing artifacts. The second should create the handoff and print the
exact Codex continuation command.
