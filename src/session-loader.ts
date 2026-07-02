import fs from "node:fs/promises";
import path from "node:path";
import { CodexAdapter } from "./adapters/codex/index.js";
import { ClaudeAdapter } from "./adapters/claude/index.js";
import { sessionIdFromFilename } from "./adapters/claude/paths.js";
import { HammaSession } from "./core/schema.js";

export type SupportedSourceCli = "codex" | "claude";

export interface SessionLoaderOptions {
  codexHome?: string;
  claudeHomes?: string[];
}

export interface ResolvedSessionTarget {
  sourceCli: SupportedSourceCli;
  sessionPath: string;
}

async function resolveDirectClaudePath(target: string): Promise<string> {
  const absolutePath = path.resolve(target);

  if (!path.isAbsolute(target) || path.extname(absolutePath) !== ".jsonl") {
    throw new Error(
      `Unsupported session target '${target}'. Use codex:<id>, claude:<id>, a Codex rollout path, or an absolute UUID-named Claude session path.`
    );
  }

  const sessionId = sessionIdFromFilename(absolutePath);
  const fileStem = path.basename(absolutePath, path.extname(absolutePath));
  if (!sessionId || fileStem !== sessionId) {
    throw new Error(
      `Cannot safely identify direct JSONL path as a Claude session: ${absolutePath}`
    );
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Claude session path is not a regular file: ${absolutePath}`);
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`Claude session file does not exist: ${absolutePath}`);
    }
    throw err;
  }

  return absolutePath;
}

export async function resolveSessionTarget(
  target: string,
  options: SessionLoaderOptions = {}
): Promise<ResolvedSessionTarget> {
  if (target.startsWith("claude:")) {
    return {
      sourceCli: "claude",
      sessionPath: await ClaudeAdapter.resolve(target, options.claudeHomes)
    };
  }

  if (target.startsWith("codex:") || path.basename(target).startsWith("rollout-")) {
    return {
      sourceCli: "codex",
      sessionPath: await CodexAdapter.resolve(target, options.codexHome)
    };
  }

  return {
    sourceCli: "claude",
    sessionPath: await resolveDirectClaudePath(target)
  };
}

export async function loadSession(
  target: string,
  options: SessionLoaderOptions = {}
): Promise<HammaSession> {
  const resolved = await resolveSessionTarget(target, options);

  if (resolved.sourceCli === "claude") {
    return ClaudeAdapter.inspect(resolved.sessionPath);
  }

  return CodexAdapter.inspect(resolved.sessionPath);
}
