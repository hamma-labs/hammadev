# Repository Guidelines

## Project Structure & Module Organization

The main TypeScript CLI lives in `src/`. Put shared behavior in `src/core/`, agent-specific integrations in `src/adapters/{claude,codex,grok}/`, command handler extractions in `src/commands/`, and executable utilities in `src/scripts/`. Tests mirror this layout under `tests/`; fixtures belong beside their adapter tests. Reusable agent skills are in `skills/`, documentation and diagrams in `docs/`, and sample inputs and generated handoffs in `examples/`. The React/Vite marketing site is a separate workspace in `website/`, with components under `website/src/components/` and Playwright tests under `website/tests/e2e/`.

## Build, Test, and Development Commands

Use Node.js 22.12+ and pnpm 10.15 (`pnpm install`). A `.nvmrc` file is provided for automatic version switching with nvm/fnm. Common commands are:

- `pnpm dev -- --help`: run the CLI directly with `tsx`.
- `pnpm build`: compile the CLI to `dist/`.
- `pnpm typecheck`: validate TypeScript without emitting files.
- `pnpm test`: run the Vitest suite once; `pnpm test:watch` runs it interactively.
- `pnpm smoke:cli`: build and verify the packaged CLI starts.
- `pnpm website:build` and `pnpm website:test:e2e`: build the site and run Chromium end-to-end tests.

## Coding Style & Naming Conventions

Follow the existing strict TypeScript and ESM style. Use two-space indentation, semicolons, double quotes in the CLI, and descriptive camelCase names; use PascalCase for React components and exported types. Name source modules in kebab-case (for example, `project-status.ts`) and tests `*.test.ts`. Keep adapter-specific parsing and path assumptions isolated within the relevant adapter directory. No formatter or linter is configured, so match adjacent code and rely on `pnpm typecheck` plus tests.

## Testing Guidelines

Add focused Vitest coverage for behavior changes, mirroring the source path where practical. Use sanitized, deterministic fixtures for session formats. Website flows use Playwright specs named `*.spec.ts`. There is no fixed coverage threshold; regressions and security-sensitive input handling should receive explicit tests.

## Commit & Pull Request Guidelines

Recent history favors imperative Conventional Commit subjects such as `feat: add ...`, `fix: tighten ...`, and `chore: bump ...`. Keep commits scoped and explain user-visible impact. Pull requests should include a concise summary, linked issue when applicable, verification commands, and screenshots for website changes. Call out format compatibility, redaction, or migration risks.

## Graphify Agent Workflow

When `graphify-out/graph.json` exists, query it before codebase exploration with `graphify query "<question>"`; use `graphify path` for relationships and `graphify explain` for concepts. Prefer `graphify-out/wiki/index.md` for broad navigation. After code changes, run `graphify update .`. Dirty graph output is expected and should not be discarded.
