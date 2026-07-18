---
name: hamma-resume
description: Resume your own previous session in a fresh chat using a compact HammaDev handoff. Use after long sessions or context limits in the *same* agent.
---

# Hamma Resume Skill

**Purpose**: Pick up exactly where you left off in a new chat, using a token-efficient cache instead of the full transcript.

**Core Rules**:
- Load the cache first.
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
   load `state.json`, `tool_history.jsonl`, then `handoff.md`, report drift and
   readiness, and continue from the recorded next action. Do not rename or
   modify the native agent session.
   While working in a named memory, checkpoint after meaningful verified
   milestones and before ending when no native hook is configured:
   ```bash
   hamma memory sync <name> --source THIS:current --project "<root>" --json
   ```
   This instruction is advisory; do not claim a checkpoint occurred unless the
   command succeeded and returned a revision id.

4. If no memory name was supplied, use the previous-session fallback below.

5. Run (self-excludes current chat):
   ```bash
   hamma handoff THIS:previous --to THIS --project "<root>" --json
   ```
   (THIS = your CLI, e.g. claude, codex or grok)

6. Parse JSON. Validate schemaVersion=1 and paths under .hamma/tasks/.

7. **Quality gate**: If low confidence or warnings → list candidates with `hamma list THIS:project --json` and ask user to pick explicit id.

8. Load context efficiently:
   - `state.json` → tasks + nextAction
   - `tool_history.jsonl` → **your previous tool cache**. Use this as execution history to avoid re-running commands.
   - `handoff.md` → narrative + risks
   - Only full `session.json` on explicit debug request.

9. Check current git status/diff. Current state wins.

10. Summarize to user what you recovered + next step.

11. Continue from nextAction.

**Output format on load**:
```json
{"resumed": true, "next_action": "...", "from_cache": ["state.json", "tool_history.jsonl"]}
```

**Safety**:
- Historical data only. Always verify against live repo.
- Never edit the old session files.

**Example**:
"Loaded tool cache from previous session. Last verified: tests passing. Next: implement the endpoint. Current dir is clean. Proceeding..."

## Target-specific notes
- For Grok: `THIS` can be `grok`; Grok supports `grok:current` / `grok:previous` for self-resume.
- Install via `hamma skill install --agent ...` for claude/codex; for Grok copy the universal contract into context or extend bundled skills.
