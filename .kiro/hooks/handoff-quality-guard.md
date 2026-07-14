---
event: file_save
filePattern: "src/**/*.ts"
command: "pnpm quality:report"
---

# Handoff Quality Guard

Automatically validates the HammaDev handoff pipeline whenever a TypeScript
source file under `src/` is created or saved.

## What it does

1. Runs `pnpm typecheck` to verify type safety.
2. Runs `pnpm test` to confirm unit/integration tests pass.
3. Runs `pnpm build` to compile the project.
4. Runs the smoke test (`node dist/cli.js --help`) to verify the compiled CLI.
5. Inspects the current Git diff to identify changed source files.
6. Detects which HammaDev components are affected by the changes.
7. Generates `docs/generated/handoff-quality-report.md` with full results.

## Trigger scope

- **Triggers on:** TypeScript file saves under `src/**/*.ts`
- **Does NOT trigger on:** Changes to `docs/generated/` (avoids recursive loops)

## Exit behavior

The script exits with a non-zero status if any required validation step fails,
signaling to Kiro that the change introduced a regression. The report is still
written regardless of pass/fail status.
