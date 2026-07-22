# Named memory checkpoints with agent hooks

HammaDev named memories are useful without hooks:

```bash
hamma save
hamma switch claude
hamma done
```

These commands automatically handle the exact source session, attach claim,
checkpoint, and completion transition. The lower-level `hamma memory ...`
commands below are documented for hook authors and automation.

Hooks are an optional checkpoint layer. They do not replace explicit sync, and
they must be reviewed and trusted in each agent. HammaDev never edits native
agent sessions. Hook input is used only to select the exact current session.

## Guided setup

Preview all managed hook, bootstrap-mode, and `.gitignore` changes without
writing project files:

```bash
hamma setup --check
```

After reviewing the exact settings paths and lifecycle events, apply them with
explicit consent and verify the resulting files:

```bash
hamma setup --apply --agent detected --bootstrap manual
```

Use `--agent all` or a comma-separated list such as `--agent claude,codex` when
agent auto-detection is not appropriate. Use `--shared` only when the Claude
hook file should be committed as `.claude/settings.json`. Setup never replaces
a differing Hamma-managed entry unless `--force` is also supplied.

## Direct hook setup

`hamma hooks install` writes the documented hook entries into this project's
agent settings files:

```bash
cd /path/to/project
hamma hooks install                  # detect installed agents (claude, codex, grok)
hamma hooks install --agent claude   # one agent explicitly
hamma hooks uninstall                # remove only Hamma-managed entries
```

What it writes per agent:

- **Claude Code** — `.claude/settings.local.json` (per-developer, not
  committed). `PreCompact` and `SessionEnd` checkpoint through
  `hamma memory sync`; `SessionStart` injects bounded memory context through
  `hamma bootstrap`. Use `--shared` to write the committable
  `.claude/settings.json` instead — only do this when every collaborator has
  `hamma` installed.
- **Codex** — `.codex/hooks.json` with a `PreCompact` checkpoint and
  `SessionStart` context injection. Codex fires `SessionStart` for startup,
  resume, clear, and post-compaction context, but has no documented session-end
  hook. Requires project trust in Codex; review the installed commands with
  `/hooks`.
- **Grok** — `.grok/hooks/hamma-memory.json` (a Hamma-owned file) with
  `PreCompact` and `SessionEnd` checkpoints plus a `SessionStart` bootstrap
  hook. Pass `--no-session-start` to skip the bootstrap hook. Requires project
  trust in Grok.

The install is idempotent and merge-safe: unrelated settings keys and
non-Hamma hook groups are preserved, re-runs skip current entries, and only
entries whose command starts with `hamma ` are ever created, replaced
(`--force`), or removed (`hamma hooks uninstall`). A settings file that is not
valid JSON is never rewritten, even with `--force`.

Installed hooks stay no-ops until an explicit workflow (`hamma save`,
`hamma switch`, or a low-level sync/attach) has enabled memory for the
project.

For the strongest Codex durability, enable memory once, trust the installed
commands through Codex's `/hooks` screen, and launch through Hamma:

```bash
hamma save --agent codex             # first-time memory enablement
hamma hooks install --agent codex
hamma codex                          # forwards the normal terminal UI
hamma codex -- --model gpt-5.4       # pass Codex options after --
```

Using plain `codex` still gets native `PreCompact` and `SessionStart`
behavior, but only `hamma codex` can observe process termination and perform
an exact final checkpoint.

## Session-start context (`hamma bootstrap`)

`hamma bootstrap` closes the read side of the loop: agents that inject
`SessionStart` hook stdout into model context (Codex, Claude Code, and Grok
do) receive a bounded slice of the frozen latest memory revision at session
start, framed as untrusted historical state.

### Bootstrap modes (`hamma config set bootstrap <manual|automatic>`)

Which sessions receive that context is governed by a per-project setting in
`.hamma/config.json`:

- **`manual` (default)** — the `SessionStart` hook prints context only when
  the session was launched through a hamma wrapper (`hamma codex`,
  `hamma claude`, `hamma grok`, or `hamma switch <agent>`). A plainly-started
  agent gets a completely normal session. The gate signal is the
  `HAMMA_<AGENT>_LAUNCH_ID` environment variable the wrapper sets for its
  child; hook subprocesses inherit it.
- **`automatic`** — context is injected at the start of every session, the
  historical always-on behavior.

Only *loading* is gated. `PreCompact`/`SessionEnd` sync hooks keep
checkpointing plain sessions in both modes, and an explicit `hamma bootstrap`
at a terminal (without `--hook-agent`) is never gated. A corrupt
`.hamma/config.json` fails closed to `manual`; `hamma config get` surfaces
the parse error.

- Read-only assembly: building the context loads the frozen revision's
  `bootstrap.md`, computes the execution mode and a one-line git drift verdict,
  and never parses transcripts or takes locks. In hook mode, the CLI first
  retries any ended Codex wrapper checkpoint; that recovery uses the normal
  exact-session parser and memory lock before context assembly begins.
- Bounded: output is capped at the initial-context budget (8 KiB body) and
  truncated on a line boundary with an explicit marker.
- Safe by framing: content is wrapped in a `<hamma-project-memory>` block that
  states it is historical data, not instructions. The recorded next action is
  included only when the execution mode is `continue_work`, and even then as
  information to confirm with the user — never as an automatic continuation.
- Silent when there is nothing to say: it exits 0 with no output when memory
  is not enabled for the project, no revision exists, `bootstrap.md` is
  missing, or an open attach claim exists (the claim owner's session already
  has that context). In hook mode any internal error also exits 0 with no
  output so a broken memory store can never block or pollute session start.

Unlike sync hooks, **bootstrap intentionally writes stdout on success** — that
stdout is the injected context. Use `--json` for a machine-readable result
including skip reasons.

## Fallback hierarchy

1. `hamma hooks install` has written trusted native lifecycle hooks that
   invoke `hamma memory sync --hook-agent ...` and `hamma bootstrap`.
2. Codex, Claude Code, or Grok was launched through `hamma codex` /
   `hamma claude` / `hamma grok`, which checkpoint the exact bound session
   when the child exits and leave failed work for next-start recovery.
3. A hand-maintained native lifecycle hook invokes the same commands (see the
   reference JSON below).
4. The installed `hamma-snap` skill invokes `hamma save` for the current agent.
5. The developer runs `hamma save` (or an exact low-level sync) explicitly.

The first `hamma save` or `hamma switch` creates the reserved `default` memory
(as do their explicit low-level sync/attach equivalents).
Lifecycle hooks deliberately remain no-ops until an explicit workflow has
enabled memory for that project.

## Reference: what gets installed

### Codex

Codex supports `PreCompact` and model-visible `SessionStart` output, but does
not expose a documented session-end hook. Together they form a native
compaction loop: Hamma checkpoints immediately before compaction and reloads
the resulting bounded memory context afterward. The same bootstrap also runs
on startup, resume, and clear. Launch through `hamma codex` for an exact exit
checkpoint, or use explicit/skill-driven sync when launching Codex directly.
Project hooks require project trust; use `/hooks` to review and trust the
installed commands.

### Reliable Codex process lifecycle

`hamma codex` fills the session-end gap without pretending that Codex's
turn-scoped `Stop` event is an exit event:

1. Before launch, Hamma creates a per-launch record under
   `.hamma/runtime/codex/` for the selected active memory.
2. The wrapper passes an opaque launch id to Codex. The native `SessionStart`
   hook binds that launch to the exact Codex `session_id`; Hamma never guesses
   from the newest transcript.
3. The real Codex process inherits the terminal and receives forwarded
   `SIGINT`, `SIGTERM`, and `SIGHUP` signals.
4. On child exit—zero, non-zero, or signal—the wrapper checkpoints the bound
   session. If the memory has an open Codex attach claim, it uses the claim's
   checkpoint path rather than bypassing task ownership.
5. A successful or unchanged checkpoint removes the launch record. A failed
   checkpoint remains atomic and retryable.
6. At the next Codex, Claude Code, or Grok `SessionStart`, Hamma retries records
   whose wrapper and child processes are both gone before it renders context.
   Records for live concurrent Codex processes are left alone.

If Codex starts without trusted hooks, the wrapper refuses to guess a session
and retains a diagnostic record instructing the user to review `/hooks`.
Runtime records are only created after project memory has been explicitly
enabled. `CODEX_HOME` is honored for non-default Codex session storage.

`.codex/hooks.json`:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent codex --no-gitignore",
            "timeout": 30,
            "statusMessage": "Checkpointing active Hamma memory"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma bootstrap --hook-agent codex",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Using `Stop` is possible but usually too noisy because Codex fires it after
each turn, not only when the interactive session closes. Hamma deliberately
does not parse and rewrite memory on every `Stop`; the process wrapper gives a
real termination boundary without adding latency to every turn.

### Claude Code

Claude Code supports deterministic command hooks for `PreCompact`,
`SessionEnd`, and `SessionStart` (whose stdout is injected into model
context). `hamma hooks install --agent claude` writes the following into
`.claude/settings.local.json`; to maintain it by hand, add it to the single
`hooks` object in a suitable project or local settings file:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent claude --no-gitignore",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent claude --no-gitignore",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma bootstrap --hook-agent claude",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Reliable Claude Code process lifecycle

Claude Code's native `SessionEnd` hook already covers clean exits, so
`hamma claude` is a thinner wrapper than `hamma codex`: it adds the one
guarantee hooks cannot give — an exact-session checkpoint observed at real
process termination, including crashes and signals that skip `SessionEnd`.

```bash
hamma claude                          # forwards the normal terminal UI
hamma claude -- --continue            # pass Claude Code options after --
```

It shares the Codex wrapper's launch-record machinery (records live under
`.hamma/runtime/claude/`): the wrapper passes an opaque launch id, the native
`SessionStart` hook binds the exact Claude `session_id`, and on child exit the
wrapper checkpoints that bound session through any open attach claim. Ended
launches whose checkpoint failed are retried at the next session start of any
supported agent. When project memory is enabled, `hamma claude` also installs
the native Claude lifecycle hooks best-effort before launching, so a first
run is self-contained; differing hand-edited entries are never replaced
(use `hamma hooks install --agent claude --force` explicitly). Runtime records
are only created after project memory has been explicitly enabled.

### Grok Build

Grok documents `PreCompact`, `SessionEnd`, and `SessionStart` hooks. Project
hook files require trust. Place a JSON hook file under `.grok/hooks/`:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent grok --no-gitignore",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent grok --no-gitignore",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma bootstrap --hook-agent grok",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Reliable Grok process lifecycle

`hamma grok` mirrors `hamma claude`: it launches the Grok CLI with an
exact-session checkpoint observed at real process termination, including
crashes and signals that skip `SessionEnd`.

```bash
hamma grok                            # forwards the normal terminal UI
hamma grok -- --resume                # pass Grok options after --
```

It shares the same launch-record machinery (records live under
`.hamma/runtime/grok/`): the wrapper passes an opaque launch id through
`HAMMA_GROK_LAUNCH_ID`, the native `SessionStart` hook binds the exact Grok
session id, and on child exit the wrapper checkpoints that bound session.
Ended launches whose checkpoint failed are retried at the next session start
of any supported agent. When project memory is enabled, `hamma grok` installs
the native Grok hooks best-effort before launching. Because Grok only runs
project hooks after the project is trusted, an untrusted project cannot bind
the session — the exit checkpoint then reports `pending` with the reason.

## Operational limits

- A killed process, disabled hook, untrusted project, unavailable `hamma`
  binary, or agent crash can prevent a checkpoint.
- `hamma codex`, `hamma claude`, and `hamma grok` recover normal exits,
  non-zero exits, Ctrl-C, forwarded termination signals, and wrapper failures
  discoverable on the next session start. They cannot recover transcript bytes
  that the agent or the filesystem never persisted, and a machine that never
  starts another trusted Hamma hook cannot perform the deferred recovery.
- A nested agent started from a shell inside a hamma-launched session inherits
  the `HAMMA_<AGENT>_LAUNCH_ID` variable and is treated as hamma-launched: in
  manual mode it still receives bootstrap context, and its session-binding
  attempt is rejected and logged as a warning. This is benign.
- Hook-mode **sync** writes no stdout on success so agent hook protocols do
  not mistake Hamma's result object for hook control output. Add `--json` only
  for manual diagnostics. (`hamma bootstrap` is the deliberate exception: its
  success stdout is the injected session-start context.)
- HammaDev uses an atomic per-memory lock and content fingerprint so concurrent
  or duplicate updates do not silently overwrite a revision.
- Repository-wide automatic source selection is intentionally disabled for
  persistent memory. Attach loads the frozen latest revision by default, and
  every memory write names one exact native session.
- An actionable attach creates a durable run claim. Generic lifecycle hooks
  skip while that claim is open; the attached agent must use
  `memory checkpoint --attach <id>` or `memory finish --attach <id>` so updates
  remain in the original task epoch. If it cannot finish,
  `memory abandon --attach <id> --reason <text>` releases the claim explicitly.
- Hooks use deterministic transcript and Git extraction. Packaged skills can
  supply richer validated knowledge through `--update-file`.
- Append-only source cursors store only new sanitized user/assistant messages.
  If native history is rewritten, HammaDev records a safe normalized snapshot
  and warns without changing older revisions.
- Hook sync parses a session that may still be actively written. If parsing
  fails, the prior immutable revision remains current and explicit sync can be
  retried.
- Memory artifacts can contain task text, file paths, commands, and tool output.
  Keep `.hamma/` local and review it before sharing.
- Do not add `PostToolUse` synchronization for every tool call. Repeated full
  session parsing adds latency and increases race and recursion risk.

## Agent documentation used

- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Grok Build hooks](https://docs.x.ai/build/features/hooks)
