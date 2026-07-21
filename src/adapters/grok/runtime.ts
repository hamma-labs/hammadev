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

// Grok-specific façade over the shared launch runtime in
// src/core/agent-launch.ts. Grok exposes native PreCompact and SessionEnd
// hooks; the wrapper binds the exact child session at SessionStart and adds
// the checkpoint observed at process termination, including crashes and
// signals that skip SessionEnd. Grok project hooks only run once the project
// is trusted inside Grok, so an untrusted project leaves the exit checkpoint
// pending with an actionable reason.

export const GROK_LAUNCH_ID_ENV = launchIdEnvVar("grok");

export type GrokLaunchState = AgentLaunchState;
export type GrokLaunchRecord = AgentLaunchRecord;
export type GrokLaunchPreparation = AgentLaunchPreparation;
export type GrokSessionRegistrationResult = AgentSessionRegistrationResult;
export type GrokCheckpointResult = AgentCheckpointResult;
export type GrokLauncherOptions = AgentLauncherOptions;

export interface GrokLauncherResult extends AgentLauncherResult {
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
 * Best-effort install of the native Grok lifecycle hooks before launching.
 * Without the SessionStart hook the launch record never binds an exact
 * session and the exit checkpoint stays pending, so `hamma grok` makes the
 * setup self-contained. Existing differing hamma-managed entries are never
 * replaced here; that stays an explicit `hamma hooks install --force`.
 */
export async function ensureGrokHooks(
  projectPath: string
): Promise<{ ensured: boolean; warning?: string }> {
  try {
    const result = await installHooks({ agent: "grok", projectPath });
    const warning = result.warnings[0];
    return { ensured: warning === undefined, warning };
  } catch (error) {
    return {
      ensured: false,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function prepareGrokLaunch(
  projectPath: string,
  options: { memory?: string; wrapperPid?: number } = {}
): Promise<GrokLaunchPreparation> {
  return prepareAgentLaunch("grok", projectPath, options);
}

export async function setGrokLaunchChildPid(
  projectPath: string,
  launchId: string,
  childPid: number
): Promise<GrokLaunchRecord> {
  return setAgentLaunchChildPid("grok", projectPath, launchId, childPid);
}

export async function registerGrokSessionStart(
  projectPath: string,
  event: Record<string, unknown>,
  launchId = process.env[GROK_LAUNCH_ID_ENV]
): Promise<GrokSessionRegistrationResult> {
  return registerAgentSessionStart("grok", projectPath, event, launchId);
}

export async function checkpointGrokLaunch(
  projectPath: string,
  launchId: string
): Promise<GrokCheckpointResult> {
  return checkpointAgentLaunch("grok", projectPath, launchId);
}

export async function listGrokLaunches(projectPath: string): Promise<GrokLaunchRecord[]> {
  return listAgentLaunches("grok", projectPath);
}

export async function recoverGrokLaunches(
  projectPath: string
): Promise<GrokCheckpointResult[]> {
  return recoverAgentLaunches("grok", projectPath);
}

export async function discardGrokLaunch(
  projectPath: string,
  launchId: string
): Promise<void> {
  return discardAgentLaunch("grok", projectPath, launchId);
}

export async function launchGrokWithRecovery(
  options: GrokLauncherOptions
): Promise<GrokLauncherResult> {
  let hooksEnsured = false;
  let hooksWarning: string | undefined;
  if (await memoryEnabled(options.projectPath, options.memory)) {
    const hooks = await ensureGrokHooks(options.projectPath);
    hooksEnsured = hooks.ensured;
    hooksWarning = hooks.warning;
  }
  const result = await launchAgentWithRecovery("grok", {
    ...options,
    command: options.command ?? "grok",
  });
  return { ...result, hooksEnsured, hooksWarning };
}
