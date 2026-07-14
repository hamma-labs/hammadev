# Handoff Quality Guard

> **Note:** This file is human-readable documentation only. The executable hook
> configuration is in `handoff-quality-guard.json`.

Automatically validates the HammaDev handoff pipeline whenever Kiro saves a
TypeScript source file under `src/`.

## How the hook works

The hook uses the **PostFileSave** trigger, meaning it runs *after* Kiro has
already written the file to disk. It does not block or prevent the save. If
validation fails, Kiro displays a warning and the command returns a non-zero
exit status, but the saved file remains on disk.

## What it does

1. Runs `pnpm typecheck` to verify type safety.
2. Runs `pnpm test` to confirm unit/integration tests pass.
3. Runs `pnpm build` to compile the project.
4. Runs the smoke test (`node dist/cli.js --help`) to verify the compiled CLI.
5. Inspects the current Git diff to identify changed source files.
6. Detects which HammaDev components are affected by the changes.
7. Generates `docs/generated/handoff-quality-report.md` with full results.

## Trigger scope

- **Triggers on:** TypeScript file saves matching `^src/.*\.ts$` (PostFileSave)
- **Does NOT trigger on:** Changes to `docs/generated/`, `tests/`, or files
  outside `src/` (the matcher regex excludes them)

## Exit behavior

The script exits with a non-zero status if any required validation step fails,
signaling to Kiro that the change introduced a regression. Because this is a
post-save hook, a failure does not undo the file save. The quality report at
`docs/generated/handoff-quality-report.md` is still written regardless of
pass/fail status so developers can review what went wrong.
