// CLI command extraction — established pattern.
//
// This directory contains extracted command handlers from the monolithic
// src/cli.ts. Each module exports a `register*Command(program)` function.
//
// Currently extracted:
//   - doctor.ts — environment validation
//   - status.ts — project overview
//
// Migration order for remaining commands (by independence):
//   - list.ts (uses shared printProjectCandidates helper)
//   - memory.ts (large subcommand tree, ~400 lines)
//   - save.ts, switch.ts, done.ts (core workflow)
//   - fix.ts, clean.ts (new interactive commands)
//   - codex.ts, claude.ts, grok.ts (agent launchers)
//   - continue.ts, handoff.ts (advanced)
//
// Each extraction should be accompanied by verifying the existing tests pass.
// The inline versions in cli.ts remain authoritative until fully migrated.

export { registerDoctorCommand } from "./doctor.js";
export { registerStatusCommand } from "./status.js";
