import fs from "node:fs/promises";
import path from "node:path";
import { CodexAdapter } from "./adapters/codex/index.js";
import { defaultCodexHome } from "./adapters/codex/paths.js";
import { ClaudeAdapter } from "./adapters/claude/index.js";
import { GrokAdapter } from "./adapters/grok/index.js";
import { defaultGrokHome } from "./adapters/grok/paths.js";
import { findSessionDir as findGrokSessionDir } from "./adapters/grok/parse.js";
import {
  candidateClaudeHomes,
  sessionIdFromFilename
} from "./adapters/claude/paths.js";
import { HammaSession } from "./core/schema.js";
import { MAX_SESSION_BYTES } from "./core/session-limits.js";

export { MAX_SESSION_BYTES };

export type SupportedSourceCli = "codex" | "claude" | "grok";

export interface SessionLoaderOptions {
  codexHome?: string;
  claudeHomes?: string[];
  grokHome?: string;
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

async function validateGrokSessionDir(
  candidateDir: string,
  grokHome?: string
): Promise<string> {
  const gHome = grokHome ?? defaultGrokHome();
  const sessionsRoot = path.join(gHome, "sessions");
  const absoluteDir = path.resolve(candidateDir);
  const rootResolved = path.resolve(sessionsRoot);
  if (!isWithin(rootResolved, absoluteDir)) {
    throw new Error("Grok session directory is outside the allowed sessions root.");
  }

  let dstat;
  try {
    dstat = await fs.stat(absoluteDir);
  } catch (error: any) {
    if (error.code === "ENOENT") throw new Error("Grok session directory does not exist.");
    throw error;
  }
  if (!dstat.isDirectory()) throw new Error("Grok session path is not a directory.");

  // Enforce size on the primary transcript file (equivalent to file size check for other agents)
  const chatPath = path.join(absoluteDir, "chat_history.jsonl");
  let cstat;
  try {
    cstat = await fs.stat(chatPath);
  } catch (error: any) {
    if (error.code === "ENOENT") throw new Error("Grok session chat_history.jsonl does not exist.");
    throw error;
  }
  if (!cstat.isFile() || cstat.size > MAX_SESSION_BYTES) {
    throw new Error(`Grok chat_history.jsonl exceeds the 50 MiB limit (${cstat.size} bytes).`);
  }

  const canonDir = await fs.realpath(absoluteDir);
  const canonRoot = await canonicalRoot(sessionsRoot);
  if (!isWithin(canonRoot, canonDir)) {
    throw new Error("Grok session resolves outside the allowed session directories.");
  }
  return canonDir;
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

  if (target.startsWith("grok:")) {
    const id = await GrokAdapter.resolve(target, {
      grokHome: options.grokHome,
      projectPath: options.projectPath,
    });
    // Locate the on-disk dir (adapters own the format knowledge).
    let dir: string;
    try {
      dir = await findGrokSessionDir(id, options.grokHome);
    } catch {
      // For non-existent (e.g. some "last" cases) fall back; parse will surface error.
      dir = id;
    }
    const validated = await validateGrokSessionDir(dir, options.grokHome);
    return {
      sourceCli: "grok",
      sessionPath: validated
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

  if (resolved.sourceCli === "grok") {
    return GrokAdapter.inspect(resolved.sessionPath, options.grokHome);
  }

  return CodexAdapter.inspect(resolved.sessionPath);
}
