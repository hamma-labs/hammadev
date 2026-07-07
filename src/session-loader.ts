import fs from "node:fs/promises";
import path from "node:path";
import { CodexAdapter } from "./adapters/codex/index.js";
import { defaultCodexHome } from "./adapters/codex/paths.js";
import { ClaudeAdapter } from "./adapters/claude/index.js";
import {
  candidateClaudeHomes,
  sessionIdFromFilename
} from "./adapters/claude/paths.js";
import { HammaSession } from "./core/schema.js";
import { MAX_SESSION_BYTES } from "./core/session-limits.js";

export { MAX_SESSION_BYTES };

export type SupportedSourceCli = "codex" | "claude";

export interface SessionLoaderOptions {
  codexHome?: string;
  claudeHomes?: string[];
  projectPath?: string;
}

export interface ResolvedSessionTarget {
  sourceCli: SupportedSourceCli;
  sessionPath: string;
}

function containsParentTraversal(value: string): boolean {
  return value.includes("..");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function canonicalRoot(root: string): Promise<string> {
  const absoluteRoot = path.resolve(root);
  try {
    return await fs.realpath(absoluteRoot);
  } catch (error: any) {
    if (error.code === "ENOENT") return absoluteRoot;
    throw error;
  }
}

async function validateSessionPath(
  sessionPath: string,
  allowedRoots: string[]
): Promise<string> {
  const absolutePath = path.resolve(sessionPath);
  const lexicalRoots = allowedRoots.map((root) => path.resolve(root));
  if (!lexicalRoots.some((root) => isWithin(root, absolutePath))) {
    throw new Error("Session path is outside the allowed session directories.");
  }

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error: any) {
    if (error.code === "ENOENT") throw new Error("Session file does not exist.");
    throw error;
  }
  if (!stat.isFile()) throw new Error("Session path is not a regular file.");
  if (stat.size > MAX_SESSION_BYTES) {
    throw new Error(`Session file exceeds the 50 MiB limit (${stat.size} bytes).`);
  }

  const canonicalPath = await fs.realpath(absolutePath);
  const canonicalRoots = await Promise.all(allowedRoots.map(canonicalRoot));
  if (!canonicalRoots.some((root) => isWithin(root, canonicalPath))) {
    throw new Error("Session path resolves outside the allowed session directories.");
  }
  return canonicalPath;
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

  return absolutePath;
}

export async function resolveSessionTarget(
  target: string,
  options: SessionLoaderOptions = {}
): Promise<ResolvedSessionTarget> {
  if (containsParentTraversal(target)) {
    throw new Error("Session target must not contain parent-directory traversal.");
  }

  if (target.startsWith("claude:")) {
    const roots = options.claudeHomes ?? candidateClaudeHomes();
    return {
      sourceCli: "claude",
      sessionPath: await validateSessionPath(
        await ClaudeAdapter.resolve(target, {
          claudeHomes: options.claudeHomes,
          projectPath: options.projectPath
        }),
        roots
      )
    };
  }

  if (target.startsWith("codex:") || path.basename(target).startsWith("rollout-")) {
    return {
      sourceCli: "codex",
      sessionPath: await validateSessionPath(
        await CodexAdapter.resolve(target, {
          codexHome: options.codexHome,
          projectPath: options.projectPath
        }),
        [path.join(options.codexHome ?? defaultCodexHome(), "sessions")]
      )
    };
  }

  return {
    sourceCli: "claude",
    sessionPath: await validateSessionPath(
      await resolveDirectClaudePath(target),
      options.claudeHomes ?? candidateClaudeHomes()
    )
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
