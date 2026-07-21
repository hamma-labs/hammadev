import {
  AgentCheckpointResult,
  AgentLauncherOptions,
  AgentLauncherResult,
  AgentLaunchPreparation,
  AgentLaunchRecord,
  AgentLaunchState,
  AgentSessionRegistrationResult,
  checkpointAgentLaunch,
  discardAgentLaunch,
  launchAgentWithRecovery,
  launchIdEnvVar,
  listAgentLaunches,
  prepareAgentLaunch,
  recoverAgentLaunches,
  registerAgentSessionStart,
  setAgentLaunchChildPid,
} from "../../core/agent-launch.js";
import { inspectMemory } from "../../core/memory.js";
import { installHooks } from "../../core/hooks-install.js";

// Claude-specific façade over the shared launch runtime in
// src/core/agent-launch.ts. Claude Code already has the most complete native
// lifecycle (SessionStart, PreCompact, SessionEnd), so the wrapper's job is
// smaller than Codex's: bind the exact child session at SessionStart and add
// the one guarantee hooks cannot give — a checkpoint observed at process
// termination, including crashes and signals that skip SessionEnd.

export const CLAUDE_LAUNCH_ID_ENV = launchIdEnvVar("claude");

export type ClaudeLaunchState = AgentLaunchState;
export type ClaudeLaunchRecord = AgentLaunchRecord;
export type ClaudeLaunchPreparation = AgentLaunchPreparation;
export type ClaudeSessionRegistrationResult = AgentSessionRegistrationResult;
export type ClaudeCheckpointResult = AgentCheckpointResult;
export type ClaudeLauncherOptions = AgentLauncherOptions;

export interface ClaudeLauncherResult extends AgentLauncherResult {
  hooksEnsured: boolean;
  hooksWarning?: string;
}

async function memoryEnabled(projectPath: string, memory?: string): Promise<boolean> {
  try {
    await inspectMemory(projectPath, memory);
    return true;
  } catch (error: any) {
    if (error.code === "ENOENT" || String(error.message).includes("No active project memory")) {
      return false;
    }
    throw error;
  }
}

/**
 * Best-effort install of the native Claude Code lifecycle hooks before
 * launching. Without the SessionStart hook the launch record never binds an
 * exact session and the exit checkpoint stays pending, so `hamma claude`
 * makes the setup self-contained. Existing differing hamma-managed entries
 * are never replaced here; that stays an explicit `hamma hooks install --force`.
 */
export async function ensureClaudeHooks(
  projectPath: string
): Promise<{ ensured: boolean; warning?: string }> {
  try {
    const result = await installHooks({ agent: "claude", projectPath });
    const warning = result.warnings[0];
    return { ensured: warning === undefined, warning };
  } catch (error) {
    return {
      ensured: false,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function prepareClaudeLaunch(
  projectPath: string,
  options: { memory?: string; wrapperPid?: number } = {}
): Promise<ClaudeLaunchPreparation> {
  return prepareAgentLaunch("claude", projectPath, options);
}

export async function setClaudeLaunchChildPid(
  projectPath: string,
  launchId: string,
  childPid: number
): Promise<ClaudeLaunchRecord> {
  return setAgentLaunchChildPid("claude", projectPath, launchId, childPid);
}

export async function registerClaudeSessionStart(
  projectPath: string,
  event: Record<string, unknown>,
  launchId = process.env[CLAUDE_LAUNCH_ID_ENV]
): Promise<ClaudeSessionRegistrationResult> {
  return registerAgentSessionStart("claude", projectPath, event, launchId);
}

export async function checkpointClaudeLaunch(
  projectPath: string,
  launchId: string
): Promise<ClaudeCheckpointResult> {
  return checkpointAgentLaunch("claude", projectPath, launchId);
}

export async function listClaudeLaunches(projectPath: string): Promise<ClaudeLaunchRecord[]> {
  return listAgentLaunches("claude", projectPath);
}

export async function recoverClaudeLaunches(
  projectPath: string
): Promise<ClaudeCheckpointResult[]> {
  return recoverAgentLaunches("claude", projectPath);
}

export async function discardClaudeLaunch(
  projectPath: string,
  launchId: string
): Promise<void> {
  return discardAgentLaunch("claude", projectPath, launchId);
}

export async function launchClaudeWithRecovery(
  options: ClaudeLauncherOptions
): Promise<ClaudeLauncherResult> {
  let hooksEnsured = false;
  let hooksWarning: string | undefined;
  if (await memoryEnabled(options.projectPath, options.memory)) {
    const hooks = await ensureClaudeHooks(options.projectPath);
    hooksEnsured = hooks.ensured;
    hooksWarning = hooks.warning;
  }
  const result = await launchAgentWithRecovery("claude", {
    ...options,
    command: options.command ?? "claude",
  });
  return { ...result, hooksEnsured, hooksWarning };
}
