# HammaDev — Memory That Belongs to the Project

## Inspiration

AI coding agents are excellent at working inside one session, but development
rarely stays inside one session—or even one agent. I regularly move between
Codex, Claude Code, and Grok depending on the task. Every switch created the
same problem: the next agent did not reliably know what had already been done,
which decisions still mattered, whether tests actually passed, or how the Git
repository had changed.

Copying an entire transcript did not solve this. It transferred a large amount
of text, but the receiving agent still had to reconstruct the current truth. In
one real continuation test, a tool-history artifact grew to 8.67 MB, largely
because of embedded image data. The receiving agent received more context, but
not better continuity. Other tests exposed an even more expensive failure: an
agent could restart work that the previous session had already completed.

That led to the idea behind HammaDev:

> Sessions belong to agents. Memory belongs to the project.

## What it does

HammaDev is a local continuity layer for AI coding agents. It discovers
project-related sessions from Codex, Claude Code, and Grok, reconstructs the
current task, and stores compact repository memory under `.hamma/`.

Instead of giving the next agent a raw transcript, HammaDev provides an
evidence-aware continuation contract containing:

- the original goal and one clear next action;
- completed and remaining work;
- verification results and their provenance;
- known risks and blockers;
- the recorded Git state and any detected drift;
- durable project decisions that should survive multiple sessions.

The normal workflow is intentionally small:

```bash
hamma save
hamma switch claude
hamma ask "why did we choose this architecture?"
hamma done
```

Native lifecycle hooks can checkpoint memory before compaction and restore
bounded context when an agent session starts. HammaDev also binds managed
launches to exact native session IDs, so it does not guess based on whichever
transcript file changed most recently.

Everything remains local. There is no HammaDev account, cloud backend,
telemetry service, or transcript upload. Native agent sessions are read but
never renamed or modified.

## How I built it

HammaDev is a strict TypeScript and ESM command-line application. Agent-specific
session formats and path assumptions are isolated in separate Codex, Claude
Code, and Grok adapters. Those adapters produce one normalized session model,
which the shared core uses for task reconstruction, session ranking, evidence
classification, Git reconciliation, readiness assessment, and memory updates.

Memory is stored as immutable local revisions. Writes are atomic, updates use a
per-memory lock, and continuation context is bounded. The default bootstrap has
an 8 KiB hard ceiling; deeper sanitized history is searched locally only when
the agent actually needs it. When memory conflicts with the live repository,
the repository is authoritative.

HammaDev existed before Build Week as a local cross-agent handoff prototype.
During the July 18–20 sprint, I used Codex as the hands-on engineering agent to
inspect that architecture, implement changes across the adapters and shared
core, run focused tests, and replay real failure shapes. I used GPT-5.6 inside
Codex for the harder reasoning: designing evidence and readiness rules,
separating the pre-event baseline from event work, and identifying cases where
completed work could incorrectly become actionable again.

The main Build Week additions were:

- intelligent session selection across supported source agents;
- Git snapshot and drift detection;
- provenance-aware evidence and explainable readiness;
- bounded continuation context and honest context benchmarking;
- persistent named project memory across multiple native sessions;
- completed-task preflights that stop unnecessary execution.

Codex was especially useful because implementation, test execution, repository
inspection, and correction stayed in one feedback loop. GPT-5.6 helped
challenge design decisions before I accepted the generated code, rather than
using Codex only as autocomplete.

## Challenges I faced

### Reconstructing state from conversation

Agent transcripts are not task databases. They contain plans, corrections,
tool output, stale statements, and multiple user objectives. A numbered list
may be a release summary rather than unfinished work. HammaDev therefore scopes
reconstruction to the latest substantive user objective and treats terminal
completion as a reason to stop, not as another handoff to execute.

### Distinguishing claims from evidence

An assistant saying “tests pass” is not equivalent to a command with a recorded
zero exit code. HammaDev preserves that distinction through provenance tags for
agent claims, commands, repository observations, tools, and user confirmation.
Readiness can then be conservative without pretending to calculate a
probability of success.

### Different agent lifecycle capabilities

Codex, Claude Code, and Grok do not expose identical lifecycle events. HammaDev
uses native hooks where they exist and a narrow process wrapper where Codex
lacks a documented session-end event. Exact session binding and recoverable
launch records were necessary to make this reliable without silently guessing.

### Preventing context amplification

My first continuation contract included too much diagnostic history. Real
black-box testing showed that archive data could dominate the prompt and make a
simple continuation slower. The fix was architectural: load only the compact
bootstrap initially, keep structured state optional, and keep raw diagnostics
archive-only and bounded.

### Remaining honest about local safety

Local-only does not automatically mean risk-free. Agent transcripts can contain
paths, commands, secrets, or untrusted instructions. HammaDev applies
best-effort redaction, traversal and symlink protections, size limits, explicit
hook setup, and a rule that source-derived text is untrusted task context. It
does not claim that redaction is a perfect security boundary.

## What I learned

The biggest lesson was that continuity is not the same as context size. A useful
handoff is small, current, evidence-aware, and willing to say “do nothing” when
the task is already complete.

I also learned that the repository must remain the final source of truth. Agent
memory is historical context; Git and the current filesystem describe what is
actually present now. Making that conflict visible is more valuable than hiding
it behind a confidence score.

Finally, the most important automation is sometimes a safe no-op. Preventing an
agent from repeating completed work can save more time and compute than making
the next generation step faster.

## Accomplishments I am proud of

- One local memory model works across three different coding agents.
- Continuation context is bounded and inspectable instead of being an opaque
  transcript dump.
- Evidence, Git drift, readiness, and task completion are explicit.
- The project has deterministic fixtures, focused Vitest coverage, package
  smoke testing, and a public npm beta.
- npm releases use trusted OIDC publishing with provenance rather than a stored
  long-lived publishing token.

## What is next

Next, I want to expand evaluation using more independently labeled real-session
derivatives, accumulate repeated macOS and Windows lifecycle evidence, and make
setup easier for developers who should not need to understand agent transcript
formats. Longer term, optional team memory could be valuable—but only if it can
remain encrypted, auditable, conflict-safe, and explicitly opt-in.

HammaDev is available as an open-source Developer Tools project:

- **GitHub:** <https://github.com/hamma-labs/hammadev>
- **Install:** `npm install -g hammadev@beta`
