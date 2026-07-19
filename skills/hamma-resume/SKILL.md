---
name: hamma-resume
description: Resume your own previous session in a fresh chat using a bounded HammaDev handoff. Use after long sessions or context limits in the *same* agent.
---

# Hamma Resume Skill

**Purpose**: Pick up where you left off from a bounded continuation brief instead of preloading the full transcript or diagnostic archives.

**Core Rules**:
- Load only `handoff.md` as initial context.
- Continue from the recorded next action.
- Reconcile with current git/files.

**When to use**:
- User says "resume previous session", "continue from last time", "new chat but pick up where we left".
- User names a Hamma project memory such as `build-week`, `auth-refactor`, or `payment-bug`.

**Steps**:

1. Get project root: `git rev-parse --show-toplevel` (fallback to cwd).

2. Check `command -v hamma`. If missing, instruct user to install + `hamma skill install --force`.

3. If the user supplied a named project memory, prefer the stable Hamma-owned thread:
   ```bash
   hamma memory resume <name> --to THIS --project "<root>" --json
   ```
   Validate the returned revision and paths under `.hamma/memories/<name>/`,
   check `resumeAllowed`, and stop when it is false. A completed memory needs no
   continuation; blocked, ambiguous, or not-ready state needs review. Otherwise,
   load only `handoff.md` as initial context, report drift and readiness, and
   continue from the recorded next action. Load `state.json` only if structured
   detail is needed. Do not rename or modify the native agent session.
   While working in a named memory, checkpoint after meaningful verified
   milestones and before ending when no native hook is configured:
   ```bash
   hamma memory sync <name> --source THIS:current --project "<root>" --json
   ```
   This instruction is advisory; do not claim a checkpoint occurred unless the
   command succeeded and returned a revision id.

4. If no memory name was supplied, use the previous-session fallback below.

5. Preflight the previous session (self-excludes current chat) without creating
   an artifact:
   ```bash
   hamma handoff THIS:previous --to THIS --project "<root>" --preflight --compact-json
   ```
   (THIS = your CLI, e.g. claude, codex or grok)

6. Parse `preflight` before creating or reading anything:
   - `completed` → emit the completed output below and stop. Do not create a
     handoff, read historical context, or re-verify the finished task unless the
     user explicitly requests verification.
   - `blocked`, `ambiguous`, or `shouldCreateHandoff == false` → report the
     recommendation and stop.
   - `actionable` → continue only when the explicit previous session is correct.

7. **Quality gate**: Inspect `source.confidence`, `source.signals`,
   `source.warnings`, and `preflight.readiness.warnings`. If confidence is low,
   signals includes `hamma-meta`, or either warning list is non-empty → list
   candidates with `hamma list THIS:project --json` and ask the user to pick an
   explicit id.

8. Create the actionable handoff:
   ```bash
   hamma handoff THIS:previous --to THIS --project "<root>" --compact-json
   ```
   Validate `schemaVersion == 1`, `handoff` is non-null, and its paths remain
   under `.hamma/tasks/`.

9. Read only `handoff.md` as initial context. Load `state.json` only when
   structured detail is necessary. `tool_history.jsonl` and `session.json` are
   archive-only diagnostics, not restored tool state; read them only for
   explicit debugging.

10. Check current git status/diff. Current state wins.

11. Summarize to user what you recovered + next step.

12. Continue from nextAction.

**Output format on load**:
```json
{"resumed": true, "next_action": "...", "initial_context": ["handoff.md"]}
```

**Output format when already completed**:
```json
{"resumed": false, "outcome": "completed", "next_action": null}
```
Then stop without additional inspection.

**Safety**:
- Historical data only. Always verify against live repo.
- Never edit the old session files.

**Example**:
"Loaded the bounded handoff. Last recorded verification: tests passing. Next: implement the endpoint. Current Git state matches. Proceeding..."

## Target-specific notes
- For Grok: `THIS` can be `grok`; Grok supports `grok:current` / `grok:previous` for self-resume.
- Install via `hamma skill install --agent ...` for claude/codex; for Grok copy the universal contract into context or extend bundled skills.
