import os from "node:os";
import path from "node:path";

/**
 * Grok CLI data directory.
 * Respects GROK_HOME env var (documented in Grok's own user-guide).
 * Falls back to ~/.grok .
 */
export function defaultGrokHome(): string {
  if (process.env.GROK_HOME) {
    return process.env.GROK_HOME;
  }
  return path.join(os.homedir(), ".grok");
}

export function grokSessionsRoot(grokHome = defaultGrokHome()): string {
  return path.join(grokHome, "sessions");
}

/**
 * Returns the directory containing a specific session's files, given its ID.
 * The actual location is discovered at runtime by scanning (see discover.ts).
 * This is a helper for documentation / future direct construction.
 */
export function grokSessionDirHint(
  sessionId: string,
  grokHome = defaultGrokHome()
): string {
  // Actual sessions live under <sessionsRoot>/<encoded-cwd>/<sessionId>/
  // Caller should use discovery or glob to resolve the real path.
  return path.join(grokSessionsRoot(grokHome), "<encoded-cwd>", sessionId);
}
