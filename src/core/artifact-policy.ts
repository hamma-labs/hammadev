import type { HammaSession } from "./schema.js";

export const INITIAL_CONTEXT_TARGET_BYTES = 6 * 1024;
export const INITIAL_CONTEXT_MAX_BYTES = 8 * 1024;

export const INITIAL_CONTEXT_ARTIFACTS = ["handoff.md"] as const;
export const SUPPORTING_CONTEXT_ARTIFACTS = ["state.json"] as const;
export const ARCHIVE_ONLY_ARTIFACTS = [
  "session.json",
  "timeline.md",
  "commands.md",
  "redaction-report.md",
  "tool_history.jsonl",
] as const;

// Raw tool output is retained only as a bounded local diagnostic archive. It
// is never part of the default receiving-agent context.
export const TOOL_HISTORY_ARCHIVE_MAX_BYTES = 32 * 1024;
export const TOOL_HISTORY_COMMAND_MAX_BYTES = 1024;
export const TOOL_HISTORY_OUTPUT_MAX_BYTES = 2 * 1024;

export function measureNormalizedSourceBytes(session: HammaSession): number {
  const messageBytes = session.messages.reduce(
    (total, message) => total + Buffer.byteLength(message.content ?? "", "utf8"),
    0
  );
  const toolBytes = session.shellCommands.reduce(
    (total, command) => total +
      Buffer.byteLength(command.command ?? "", "utf8") +
      Buffer.byteLength(command.output ?? "", "utf8"),
    0
  );
  return messageBytes + toolBytes;
}
