# HammaDev Usability Testing Guide

## Purpose

Validate that the HammaDev CLI is understandable and usable by developers who
did not build it. Identify friction points that the team cannot see from the
inside.

## Participant profile

- Active AI coding agent user (Codex, Claude Code, or Grok)
- Has used at least one agent for more than a week
- Has experienced the "context lost" problem across sessions or agents
- Comfortable with terminal CLIs and npm/node tooling
- Mix: some with only one agent, some with multiple

## Session protocol (30–45 minutes)

### Pre-session (5 min)

1. Confirm participant has Node 22.12+ and at least one agent installed.
2. Ensure a project with recent agent sessions exists.
3. Do NOT explain what Hamma does beyond "a CLI tool for AI coding agents."

### Task 1: Install and first run (10 min)

Ask: "Install this tool and try it out."

Observe:
- Do they read the README or just run `npm install -g hammadev@beta`?
- Does `hamma` succeed on first try?
- Do they understand the agent selection prompt?
- Do they approve or decline the setup consent? Why?
- How long until the first successful agent launch?

### Task 2: Switch agents (5 min)

Ask: "Save your current work and move to [other agent]."

Observe:
- Do they find `hamma switch`?
- Do they understand the save + context transfer?
- Do they notice the "✓ Current work saved" confirmation?
- Any confusion about `save` vs `switch` vs `done`?

### Task 3: Ask a question (5 min)

Ask: "Find out why your project made a specific technical decision."

Observe:
- Do they discover `hamma ask`?
- Is the output readable and helpful?
- Do they understand what's being searched?
- Do they try to narrow or broaden the query?

### Task 4: Mark work complete (5 min)

Ask: "You've finished this task. Close it out."

Observe:
- Do they find `hamma done`?
- Do they understand what "closing" means?
- Any confusion about `--blocked` vs completing?

### Task 5: Fix something wrong (5 min)

Tell them: "The memory says your task is still in progress, but it's actually done."

Observe:
- Do they find `hamma fix`?
- Is the interactive flow clear?
- Do they successfully close it?

### Post-session debrief (5 min)

- What was confusing?
- What would you never use?
- Would you use this daily? Why/why not?
- What's the one thing that would make you recommend it?

## Metrics to track

| Metric | Target | Measurement |
| --- | --- | --- |
| First-run success | > 90% | Completed `hamma` without error on first try |
| Time to first save | < 3 minutes | From install to first `hamma save` completion |
| Command discoverability | > 80% | Found the right command without help text |
| Save/switch/done clarity | > 70% | Used the correct command for the situation |
| Ask satisfaction | > 60% | Got a useful answer on first query |
| Fix success | > 80% | Successfully corrected state using `hamma fix` |
| Would-use-again | > 70% | Verbal confirmation of daily use intent |

## Known issues to watch for

- Users not realizing `hamma` (bare) is the primary entry point
- Confusion between `save` (checkpoint) and `done` (close)
- The `manual` vs `automatic` bootstrap mode distinction
- Memory jargon: epochs, revisions, knowledge, claims
- The Node.js version requirement blocking install
- Users trying to run `hamma` outside a Git repository

## Iteration process

1. Run 3–5 sessions.
2. Document each friction point with severity (blocker / confusion / annoyance).
3. Prioritize fixes by frequency × severity.
4. Implement fixes.
5. Re-test with new participants (never reuse participants for the same tasks).
