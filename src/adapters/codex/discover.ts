import fs from "node:fs";
import fsp from "node:fs/promises";
import readline from "node:readline";
import fg from "fast-glob";
import { codexSessionsGlob, defaultCodexHome, parseRolloutFilename } from "./paths.js";

export interface CodexSessionRef {
  sourceCli: "codex";
  conversationId: string;
  path: string;
  startedAt?: string;
  lastUpdatedAt?: string;
  sizeBytes?: number;
  projectPathHint?: string;
}

const PEEK_MAX_LINES = 40;

/**
 * Read the recorded working directory (cwd) from a rollout's head. Codex records
 * it in the `session_meta` line and repeats it in `turn_context` lines. This is
 * best-effort and reads at most PEEK_MAX_LINES before giving up.
 */
async function readCodexCwd(filePath: string): Promise<string | undefined> {
  let stream: fs.ReadStream | undefined;
  try {
    stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let seen = 0;
    for await (const line of rl) {
      seen += 1;
      if (line.trim()) {
        let item: any;
        try {
          item = JSON.parse(line);
        } catch {
          if (seen >= PEEK_MAX_LINES) break;
          continue;
        }

        const topType = String(item?.type ?? "");
        const payload = item?.payload ?? {};
        if (
          (topType === "session_meta" || topType === "turn_context") &&
          typeof payload.cwd === "string" &&
          payload.cwd
        ) {
          return payload.cwd;
        }
      }
      if (seen >= PEEK_MAX_LINES) break;
    }
  } catch {
    // Peek is best-effort; ignore read errors.
  } finally {
    stream?.destroy();
  }

  return undefined;
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

    const stat = await fsp.stat(file);
    const projectPathHint = await readCodexCwd(file);

    sessions.push({
      sourceCli: "codex",
      conversationId: parsed.conversationId,
      path: file,
      startedAt: parsed.startedAt,
      lastUpdatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      projectPathHint
    });
  }

  return sessions.sort((a, b) => {
    const at = a.lastUpdatedAt ? new Date(a.lastUpdatedAt).getTime() : 0;
    const bt = b.lastUpdatedAt ? new Date(b.lastUpdatedAt).getTime() : 0;
    return bt - at;
  });
}
