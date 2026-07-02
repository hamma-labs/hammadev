import os from "node:os";
import path from "node:path";

export function defaultCodexHome(): string {
  return path.join(os.homedir(), ".codex");
}

export function codexSessionsGlob(codexHome = defaultCodexHome()): string {
  return path.join(codexHome, "sessions", "*", "*", "*", "rollout-*.jsonl");
}

const ROLLOUT_RE =
  /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(.+)\.jsonl$/;

export function parseRolloutFilename(filePath: string): {
  timestampRaw: string;
  conversationId: string;
  startedAt: string;
} | null {
  const base = path.basename(filePath);
  const match = base.match(ROLLOUT_RE);
  if (!match) return null;

  const [, timestampRaw, conversationId] = match;

  return {
    timestampRaw,
    conversationId,
    startedAt: timestampRaw.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3")
  };
}
