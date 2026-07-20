import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { discoverClaudeSessions } from "../adapters/claude/discover.js";
import { discoverCodexSessions } from "../adapters/codex/discover.js";
import { discoverGrokSessions } from "../adapters/grok/discover.js";
import { HandoffHistoryEntry, listHandoffs } from "./history.js";
import { listMemories } from "./memory.js";
import { filterSessionsByProject } from "./project-match.js";

const execFileAsync = promisify(execFile);

export type ProjectGitStatus =
  | "clean"
  | "dirty"
  | "not-a-repository"
  | "unavailable";

export interface ProjectStatusOptions {
  codexHome?: string;
  claudeHomes?: string[];
  grokHome?: string;
}

export interface ProjectStatus {
  projectPath: string;
  isGitRepo: boolean;
  gitStatus: ProjectGitStatus;
  handoffCount: number;
  latestHandoff?: {
    taskId: string;
    path: string;
    sourceAgent?: string;
    targetAgent?: string;
  };
  codexSessionCount: number;
  claudeSessionCount: number;
  grokSessionCount: number;
  codexProjectSessionCount: number;
  claudeProjectSessionCount: number;
  grokProjectSessionCount: number;
  hammaIgnored: boolean | null;
  memory: {
    count: number;
    activeName?: string;
    revisionCount: number;
    outcome?: "completed" | "actionable" | "blocked" | "ambiguous";
    openAttachId?: string;
    openAttachTarget?: string;
  };
}

interface GitOverview {
  isGitRepo: boolean;
  gitStatus: ProjectGitStatus;
  hammaIgnored: boolean | null;
}

function safeMetadata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return sanitized ? sanitized.slice(0, 80) : undefined;
}

async function inspectGit(projectPath: string): Promise<GitOverview> {
  try {
    const repository = await execFileAsync(
      "git",
      ["-C", projectPath, "rev-parse", "--is-inside-work-tree"],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      }
    );
    if (repository.stdout.trim() !== "true") {
      return {
        isGitRepo: false,
        gitStatus: "not-a-repository",
        hammaIgnored: null,
      };
    }
  } catch (error: any) {
    return {
      isGitRepo: false,
      gitStatus: error.code === "ENOENT" ? "unavailable" : "not-a-repository",
      hammaIgnored: null,
    };
  }

  let gitStatus: ProjectGitStatus = "unavailable";
  try {
    const status = await execFileAsync(
      "git",
      ["-C", projectPath, "status", "--porcelain"],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      }
    );
    gitStatus = status.stdout.trim() ? "dirty" : "clean";
  } catch {
    // Keep the explicit unavailable state when status cannot be read.
  }

  let hammaIgnored = false;
  try {
    await execFileAsync(
      "git",
      [
        "-C",
        projectPath,
        "check-ignore",
        "-q",
        "--no-index",
        "--",
        ".hamma/status-probe",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      }
    );
    hammaIgnored = true;
  } catch (error: any) {
    if (error.code !== 1) hammaIgnored = false;
  }

  return { isGitRepo: true, gitStatus, hammaIgnored };
}

async function countTaskDirectories(projectPath: string): Promise<number> {
  const tasksPath = path.join(projectPath, ".hamma", "tasks");
  try {
    const entries = await fs.readdir(tasksPath, { withFileTypes: true });
    return entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith(".tmp-")
    ).length;
  } catch (error: any) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

async function routeFromState(
  latest: HandoffHistoryEntry
): Promise<{ sourceAgent?: string; targetAgent?: string }> {
  try {
    const statePath = path.join(path.dirname(latest.handoffPath), "state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    return {
      sourceAgent: safeMetadata(state?.project?.sourceCli ?? state?.sourceCli),
      targetAgent: safeMetadata(state?.project?.targetCli ?? state?.targetCli),
    };
  } catch {
    return {};
  }
}

async function latestHandoffStatus(
  handoffs: HandoffHistoryEntry[]
): Promise<ProjectStatus["latestHandoff"]> {
  const latest = handoffs[0];
  if (!latest) return undefined;

  const stateRoute =
    latest.sourceAgent === "unknown" || latest.targetAgent === "unknown"
      ? await routeFromState(latest)
      : {};

  return {
    taskId: latest.taskId,
    path: latest.handoffPath,
    sourceAgent:
      safeMetadata(latest.sourceAgent) === "unknown"
        ? stateRoute.sourceAgent
        : safeMetadata(latest.sourceAgent),
    targetAgent:
      safeMetadata(latest.targetAgent) === "unknown"
        ? stateRoute.targetAgent
        : safeMetadata(latest.targetAgent),
  };
}

export async function getProjectStatus(
  projectPath: string,
  options: ProjectStatusOptions = {}
): Promise<ProjectStatus> {
  const resolvedProjectPath = path.resolve(projectPath);
  let stats;
  try {
    stats = await fs.stat(resolvedProjectPath);
  } catch (error: any) {
    throw new Error(
      `Cannot inspect project '${resolvedProjectPath}': ${error.message}`
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(`Project path is not a directory: ${resolvedProjectPath}`);
  }

  const [git, handoffCount, handoffs, codexSessions, claudeSessions, grokSessions, memories] =
    await Promise.all([
      inspectGit(resolvedProjectPath),
      countTaskDirectories(resolvedProjectPath),
      listHandoffs(resolvedProjectPath),
      discoverCodexSessions(options.codexHome),
      discoverClaudeSessions(options.claudeHomes),
      discoverGrokSessions(options.grokHome),
      listMemories(resolvedProjectPath),
    ]);

  const [codexProject, claudeProject, grokProject] = await Promise.all([
    filterSessionsByProject(codexSessions, resolvedProjectPath),
    filterSessionsByProject(claudeSessions, resolvedProjectPath),
    filterSessionsByProject(grokSessions, resolvedProjectPath),
  ]);

  return {
    projectPath: resolvedProjectPath,
    isGitRepo: git.isGitRepo,
    gitStatus: git.gitStatus,
    handoffCount,
    latestHandoff: await latestHandoffStatus(handoffs),
    codexSessionCount: codexSessions.length,
    claudeSessionCount: claudeSessions.length,
    grokSessionCount: grokSessions.length,
    codexProjectSessionCount: codexProject.matches.length,
    claudeProjectSessionCount: claudeProject.matches.length,
    grokProjectSessionCount: grokProject.matches.length,
    hammaIgnored: git.hammaIgnored,
    memory: {
      count: memories.length,
      activeName: memories.find((memory) => memory.active)?.name,
      revisionCount: memories.find((memory) => memory.active)?.revisionCount ?? 0,
      outcome: memories.find((memory) => memory.active)?.outcome,
      openAttachId: memories.find((memory) => memory.active)?.openAttachId,
      openAttachTarget: memories.find((memory) => memory.active)?.openAttachTarget,
    },
  };
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export function formatProjectStatus(status: ProjectStatus): string {
  const latest = status.latestHandoff;
  const route =
    latest?.sourceAgent && latest.targetAgent
      ? `${latest.sourceAgent} → ${latest.targetAgent}`
      : "unknown";
  const ignored =
    status.hammaIgnored === null
      ? status.gitStatus === "unavailable"
        ? "n/a (git unavailable)"
        : "n/a (not a git repository)"
      : yesNo(status.hammaIgnored);
  const simpleNext = status.memory.openAttachId
    ? "hamma save  (checkpoint)  or  hamma done"
    : status.memory.activeName
      ? "hamma switch <codex|claude|grok>"
      : "hamma save";

  return [
    `Project: ${status.projectPath}`,
    `Git repository: ${yesNo(status.isGitRepo)}`,
    `Git status: ${status.gitStatus}`,
    `.hamma/tasks count: ${status.handoffCount}`,
    `Latest handoff id: ${latest?.taskId ?? "none"}`,
    `Latest handoff path: ${latest?.path ?? "none"}`,
    `Latest source → target: ${latest ? route : "none"}`,
    `Codex sessions: ${status.codexSessionCount}`,
    `Claude sessions: ${status.claudeSessionCount}`,
    `Grok sessions: ${status.grokSessionCount}`,
    `Codex project sessions: ${status.codexProjectSessionCount}`,
    `Claude project sessions: ${status.claudeProjectSessionCount}`,
    `Grok project sessions: ${status.grokProjectSessionCount}`,
    `.hamma/ ignored: ${ignored}`,
    `Repository memories: ${status.memory.count}`,
    `Active memory: ${status.memory.activeName ?? "none (first explicit sync or attach creates default)"}`,
    `Active memory revisions: ${status.memory.revisionCount}`,
    `Active memory outcome: ${status.memory.outcome ?? "none"}`,
    `Open memory attach: ${status.memory.openAttachId ? `${status.memory.openAttachId} (${status.memory.openAttachTarget})` : "none"}`,
    `Recommended next command: ${simpleNext}`,
  ].join("\n");
}
