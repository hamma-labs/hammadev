import fs from "node:fs/promises";
import fg from "fast-glob";
import { codexSessionsGlob, defaultCodexHome, parseRolloutFilename } from "./paths.js";

export interface CodexSessionRef {
  sourceCli: "codex";
  conversationId: string;
  path: string;
  startedAt?: string;
  lastUpdatedAt?: string;
  sizeBytes?: number;
}

export async function discoverCodexSessions(
  codexHome: string = defaultCodexHome()
): Promise<CodexSessionRef[]> {
  const pattern = codexSessionsGlob(codexHome);
  const files = await fg(pattern, { onlyFiles: true, dot: true });

  const sessions: CodexSessionRef[] = [];

  for (const file of files) {
    const parsed = parseRolloutFilename(file);
    if (!parsed) continue;

    const stat = await fs.stat(file);

    sessions.push({
      sourceCli: "codex",
      conversationId: parsed.conversationId,
      path: file,
      startedAt: parsed.startedAt,
      lastUpdatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size
    });
  }

  return sessions.sort((a, b) => {
    const at = a.lastUpdatedAt ? new Date(a.lastUpdatedAt).getTime() : 0;
    const bt = b.lastUpdatedAt ? new Date(b.lastUpdatedAt).getTime() : 0;
    return bt - at;
  });
}
