# Installation and testing

## Requirements

- **Node.js:** 22.12 or newer
- **Git:** required; run HammaDev from inside a Git repository
- **Supported agents:** Codex, Claude Code, and Grok
- **Target platforms:** Linux, macOS, and Windows where Node.js, Git, and the
  selected agent CLI are available

HammaDev is a public beta. Its strongest real-world lifecycle testing has been
on Linux, so macOS and Windows users should review generated hooks and local
paths before relying on automatic checkpoints.

## Install the public beta

```bash
npm install -g hammadev@beta
hamma --version
```

Use the `beta` tag explicitly. The npm `latest` tag intentionally points to an
older prerelease.

## Quick read-only test

Open a Git repository that has previously been used with at least one supported
agent, then run:

```bash
cd /path/to/project
hamma
hamma doctor
hamma list codex
```

`hamma` and `hamma doctor` are read-only. They report the runtime, Git project,
detected agent installations, local project sessions, handoff history, and
`.hamma/` ignore coverage. Replace `codex` with `claude` or `grok` when testing
another source agent.

## Test an intelligent continuation

The explain step is read-only and shows which project session would be selected:

```bash
hamma continue --to claude --explain
```

If the selected current task is actionable, create its local handoff:

```bash
hamma continue --to claude
hamma show latest --check-drift --readiness
hamma benchmark latest
```

Expected behavior:

1. HammaDev selects and explains the strongest resumable project session.
2. It creates `.hamma/tasks/<task-id>/handoff.md` only when work is actionable.
3. `show` reports repository drift and a readiness result.
4. `benchmark` separates initial continuation context from optional supporting
   and archive-only artifacts.
5. If the task is already completed, blocked, ambiguous, or unsafe to resume,
   HammaDev returns a no-op recommendation instead of restarting it.

The destination agent does not need to be installed to inspect the generated
handoff. Install Claude Code only if you want to launch the complete switch.

## Test the everyday workflow

From a live Codex, Claude Code, or Grok project session:

```bash
hamma save
hamma switch claude
```

In the receiving session:

```bash
hamma ask "what is the current goal?"
hamma save
hamma done
```

`hamma save` checkpoints the detected exact session. `hamma switch claude`
creates bounded continuation context and opens Claude Code when it is installed
and the terminal is interactive. Substitute `codex` or `grok` as the target.

Optional lifecycle hooks can be installed with:

```bash
hamma hooks install
```

Review the generated agent hook files before trusting them. HammaDev preserves
unrelated hook entries and never modifies native session files.

## Run the project from source

```bash
git clone https://github.com/hamma-labs/hammadev.git
cd hammadev
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm smoke:cli
```

The repository also contains sanitized, fabricated fixtures under `examples/`.
They contain no real user conversations or credentials and can be inspected to
understand the normalized session and generated handoff formats.

## Local data and cleanup

HammaDev stores project memory in `.hamma/` and makes no HammaDev network
requests. Local memory may still contain task text, paths, commands, and tool
output, so test with a non-sensitive repository first.

To remove project-generated test data, delete that test repository's `.hamma/`
directory after confirming it contains nothing you need. Optional Hamma-managed
hooks can be removed without touching unrelated entries:

```bash
hamma hooks uninstall
```

## Links

- **Source:** <https://github.com/hamma-labs/hammadev>
- **npm:** <https://www.npmjs.com/package/hammadev>
- **License:** ISC
