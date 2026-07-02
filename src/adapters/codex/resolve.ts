import fs from "node:fs/promises";
import path from "node:path";
import { discoverCodexSessions, CodexSessionRef } from "./discover.js";

const CODEX_PREFIX = "codex:";

export async function resolveCodexTarget(target: string): Promise<string> {
  if (target.startsWith(CODEX_PREFIX)) {
    const rest = target.slice(CODEX_PREFIX.length);
    if (!rest) {
      throw new Error(
        `Invalid Codex target '${target}'. Expected 'codex:last', 'codex:<conversationId>', or a rollout file path.`
      );
    }

    const sessions = await discoverCodexSessions();

    if (rest === "last") {
      const latest = sessions[0];
      if (!latest) throw new Error("No Codex sessions found.");
      return latest.path;
    }

    return resolveByConversationId(rest, sessions);
  }

  return resolveByFilePath(target);
}

function resolveByConversationId(
  id: string,
  sessions: CodexSessionRef[]
): string {
  const exact = sessions.find((s) => s.conversationId === id);
  if (exact) return exact.path;

  const prefixMatches = sessions.filter((s) =>
    s.conversationId.startsWith(id)
  );

  if (prefixMatches.length === 1) return prefixMatches[0].path;

  if (prefixMatches.length > 1) {
    const list = prefixMatches
      .map((s) => `  - ${s.conversationId} (${s.path})`)
      .join("\n");
    throw new Error(
      `Ambiguous Codex conversationId prefix '${id}'. Matches ${prefixMatches.length} sessions:\n${list}`
    );
  }

  throw new Error(
    `No Codex session found with conversationId matching '${id}'.`
  );
}

async function resolveByFilePath(target: string): Promise<string> {
  const abs = path.resolve(target);
  const base = path.basename(abs);

  if (!abs.endsWith(".jsonl")) {
    throw new Error(
      `Rollout file must have a .jsonl extension: ${abs}`
    );
  }

  if (!base.startsWith("rollout-")) {
    throw new Error(
      `Rollout file basename must start with 'rollout-': ${base}`
    );
  }

  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      throw new Error(`Rollout path is not a regular file: ${abs}`);
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`Rollout file does not exist: ${abs}`);
    }
    throw err;
  }

  return abs;
}
