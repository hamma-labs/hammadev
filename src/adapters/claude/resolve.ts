import {
  ClaudeSessionRef,
  discoverClaudeSessions
} from "./discover.js";

const CLAUDE_PREFIX = "claude:";

export interface ResolveClaudeOptions {
  claudeHomes?: string[];
}

export async function resolveClaudeTarget(
  target: string,
  options: ResolveClaudeOptions = {}
): Promise<string> {
  if (!target.startsWith(CLAUDE_PREFIX)) {
    throw new Error(
      `Invalid Claude target '${target}'. Expected 'claude:last' or 'claude:<sessionId>'.`
    );
  }

  const rest = target.slice(CLAUDE_PREFIX.length);
  if (!rest) {
    throw new Error(
      `Invalid Claude target '${target}'. Expected 'claude:last' or 'claude:<sessionId>'.`
    );
  }

  const sessions = await discoverClaudeSessions(options.claudeHomes);
  if (sessions.length === 0) {
    throw new Error(
      "No Claude Code session files found. Looked under ~/.claude, ~/.config/claude, and ~/.local/share/claude."
    );
  }

  if (rest === "last") return sessions[0].path;

  return resolveBySessionId(rest, sessions);
}

function resolveBySessionId(id: string, sessions: ClaudeSessionRef[]): string {
  const withIds = sessions.filter(
    (s): s is ClaudeSessionRef & { sessionId: string } => !!s.sessionId
  );

  const exact = withIds.find((s) => s.sessionId === id);
  if (exact) return exact.path;

  const prefixMatches = withIds.filter((s) => s.sessionId.startsWith(id));

  if (prefixMatches.length === 1) return prefixMatches[0].path;

  if (prefixMatches.length > 1) {
    const list = prefixMatches
      .map((s) => `  - ${s.sessionId} (${s.path})`)
      .join("\n");
    throw new Error(
      `Ambiguous Claude sessionId prefix '${id}'. Matches ${prefixMatches.length} sessions:\n${list}`
    );
  }

  throw new Error(
    `No Claude session found with sessionId matching '${id}'.`
  );
}
