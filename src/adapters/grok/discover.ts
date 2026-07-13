import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { defaultGrokHome, grokSessionsRoot } from "./paths.js";
import { MAX_SESSION_BYTES } from "../../core/session-limits.js";

export interface GrokSessionRef {
  sourceCli: "grok";
  sessionId: string;
  sessionDir: string;
  lastUpdatedAt: string;
  projectPathHint?: string;
  sizeBytes?: number;
}

/**
 * Discover Grok sessions by scanning for summary.json under ~/.grok/sessions/.
 * Each session lives in: <sessionsRoot>/<encoded-cwd-or-slug>/<sessionId>/
 * summary.json is small, authoritative for id/cwd/timestamps/title.
 *
 * Note on SQLite: ~/.grok/sessions/session_search.sqlite (table session_docs)
 * is an FTS5 derived index used only for `grok sessions search` / picker.
 * worktrees.db tracks git worktrees. Neither contains the primary transcript
 * or tool history (confirmed by direct inspection + the backgrounded
 * sqlite schema query in the analysis session). We deliberately avoid any
 * sqlite dependency and use the file layout for correctness and zero extra deps.
 */
export async function discoverGrokSessions(
  grokHome?: string
): Promise<GrokSessionRef[]> {
  const home = grokHome ?? defaultGrokHome();
  const root = grokSessionsRoot(home);

  let files: string[] = [];
  try {
    files = await fg(path.join(root, "**", "summary.json"), {
      onlyFiles: true,
      dot: true,
      absolute: true,
    });
  } catch {
    return [];
  }

  const sessions: GrokSessionRef[] = [];

  for (const summaryPath of files) {
    const sessionDir = path.dirname(summaryPath);
    try {
      const stat = await fsp.lstat(summaryPath);
      if (!stat.isFile() || stat.size > MAX_SESSION_BYTES) continue;

      const raw = await fsp.readFile(summaryPath, "utf8");
      const summary = JSON.parse(raw);

      const id: string =
        (summary?.info?.id as string) || path.basename(sessionDir);
      if (!id) continue;

      const updatedAt: string =
        (summary?.updated_at as string) ||
        (summary?.last_active_at as string) ||
        stat.mtime.toISOString();

      const cwd: string | undefined =
        (summary?.info?.cwd as string) ||
        (summary?.git_root_dir as string) ||
        undefined;

      sessions.push({
        sourceCli: "grok",
        sessionId: id,
        sessionDir,
        lastUpdatedAt: updatedAt,
        projectPathHint: cwd,
        sizeBytes: stat.size,
      });
    } catch {
      // best effort per session
      continue;
    }
  }

  // newest first
  sessions.sort((a, b) => {
    const at = Date.parse(a.lastUpdatedAt || "0");
    const bt = Date.parse(b.lastUpdatedAt || "0");
    return bt - at;
  });

  return sessions;
}
