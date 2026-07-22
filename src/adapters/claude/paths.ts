import os from "node:os";
import path from "node:path";

export function defaultClaudeHome(): string {
  return process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude");
}

export function candidateClaudeHomes(): string[] {
  if (process.env.CLAUDE_HOME) return [process.env.CLAUDE_HOME];
  const home = os.homedir();
  return [
    path.join(home, ".claude"),
    path.join(home, ".config", "claude"),
    path.join(home, ".local", "share", "claude")
  ];
}

export function claudeProjectsGlobs(claudeHome: string): string[] {
  return [
    path.join(claudeHome, "projects", "**", "*.jsonl"),
    path.join(claudeHome, "sessions", "**", "*.jsonl"),
    path.join(claudeHome, "history", "**", "*.jsonl")
  ];
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function sessionIdFromFilename(filePath: string): string | undefined {
  const base = path.basename(filePath, path.extname(filePath));
  const match = base.match(UUID_RE);
  return match ? match[0] : undefined;
}
