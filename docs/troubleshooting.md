# Troubleshooting

HammaDev reports broad error categories instead of exposing internal error codes.
Run the command again with `--log-level debug` (or set
`HAMMA_LOG_LEVEL=debug`) to emit local JSONL diagnostics to stderr. Each record
includes a trace ID and operation name. Logs are disabled by default and are
never uploaded.

## cli_error

Check the command name, positional arguments, and option values with
`hamma --help` or `hamma <command> --help`.

## session_error

Session inputs must be regular `.jsonl` files under the configured Codex or
Claude home directories. Parent traversal (`..`), symlink escapes, and files
larger than 50 MiB are rejected. Use the `codex:<id>` or `claude:<id>` form when
possible.

## handoff_error

Confirm the source session is valid, the target agent is supported, and the
source project directory is writable. Use `--project <path>` for project-scoped
targets.

## project_error

Confirm the project exists and that Git metadata is readable. `hamma status`
is read-only but requires access to the selected project directory.

## history_error

Confirm the task ID contains no path separators and that the project's
`.hamma/tasks/` directory is readable.

## environment_error

Run `hamma doctor` and address failed checks for Node.js, Git, agent homes, or
filesystem permissions.

## install_error

Check the selected agent and destination home. Use `--force` only when an
existing HammaDev skill should be replaced.
