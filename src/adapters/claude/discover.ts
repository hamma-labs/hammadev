import fs from "node:fs";
import fsp from "node:fs/promises";
import readline from "node:readline";
import fg from "fast-glob";
import { MAX_SESSION_BYTES } from "../../core/session-limits.js";
import {
  candidateClaudeHomes,
  claudeProjectsGlobs,
  sessionIdFromFilename
} from "./paths.js";

export interface ClaudeSessionRef {
  sourceCli: "claude";
  path: string;
  sizeBytes: number;
  lastUpdatedAt: string;
  sessionId?: string;
  projectPathHint?: string;
  claudeHome: string;
}

const PEEK_MAX_LINES = 8;

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function peekMetadata(
  filePath: string
): Promise<{ sessionId?: string; projectPathHint?: string }> {
  const result: { sessionId?: string; projectPathHint?: string } = {};

  let stream: fs.ReadStream | undefined;
  try {
    stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let seen = 0;
    for await (const line of rl) {
      seen += 1;
      if (!line.trim()) continue;

      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        if (seen >= PEEK_MAX_LINES) break;
        continue;
      }

      if (!result.sessionId && typeof obj?.sessionId === "string") {
        result.sessionId = obj.sessionId;
      }
      if (!result.projectPathHint && typeof obj?.cwd === "string") {
        result.projectPathHint = obj.cwd;
      }

      if (result.sessionId && result.projectPathHint) break;
      if (seen >= PEEK_MAX_LINES) break;
    }
  } catch {
    // Peek is best-effort; ignore read errors.
  } finally {
    stream?.destroy();
  }

  return result;
}

export async function discoverClaudeSessions(
  claudeHomes: string[] = candidateClaudeHomes()
): Promise<ClaudeSessionRef[]> {
  const refs: ClaudeSessionRef[] = [];

  for (const home of claudeHomes) {
    if (!(await pathExists(home))) continue;

    const patterns = claudeProjectsGlobs(home);
    const files = await fg(patterns, { onlyFiles: true, dot: true });

    for (const file of files) {
      let stat;
      try {
        stat = await fsp.lstat(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const { sessionId: peekedId, projectPathHint } = stat.size <= MAX_SESSION_BYTES
        ? await peekMetadata(file)
        : {};
      const sessionId = peekedId ?? sessionIdFromFilename(file);

      refs.push({
        sourceCli: "claude",
        path: file,
        sizeBytes: stat.size,
        lastUpdatedAt: stat.mtime.toISOString(),
        sessionId,
        projectPathHint,
        claudeHome: home
      });
    }
  }

  return refs.sort((a, b) => {
    const at = new Date(a.lastUpdatedAt).getTime();
    const bt = new Date(b.lastUpdatedAt).getTime();
    return bt - at;
  });
}
