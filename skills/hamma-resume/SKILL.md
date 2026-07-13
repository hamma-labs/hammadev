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

**Steps**:

1. Get project root: `git rev-parse --show-toplevel` (fallback to cwd).

2. Check `command -v hamma`. If missing, instruct user to install + `hamma skill install --force`.

3. Run (self-excludes current chat):
   ```bash
   hamma handoff THIS:previous --to THIS --project "<root>" --json
   ```
   (THIS = your CLI, e.g. claude, codex or grok)

4. Parse JSON. Validate schemaVersion=1 and paths under .hamma/tasks/.

5. **Quality gate**: If low confidence or warnings → list candidates with `hamma list THIS:project --json` and ask user to pick explicit id.

6. Load context efficiently:
   - `state.json` → tasks + nextAction
   - `tool_history.jsonl` → **your previous tool cache**. Use this as execution history to avoid re-running commands.
   - `handoff.md` → narrative + risks
   - Only full `session.json` on explicit debug request.

7. Check current git status/diff. Current state wins.

8. Summarize to user what you recovered + next step.

9. Continue from nextAction.

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
