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

// Codex-specific façade over the shared launch runtime in
// src/core/agent-launch.ts. The record format, locking, and recovery
// semantics are shared with the Claude wrapper.

export const CODEX_LAUNCH_ID_ENV = launchIdEnvVar("codex");

export type CodexLaunchState = AgentLaunchState;
export type CodexLaunchRecord = AgentLaunchRecord;
export type CodexLaunchPreparation = AgentLaunchPreparation;
export type CodexSessionRegistrationResult = AgentSessionRegistrationResult;
export type CodexCheckpointResult = AgentCheckpointResult;
export type CodexLauncherOptions = AgentLauncherOptions;
export type CodexLauncherResult = AgentLauncherResult;

export async function prepareCodexLaunch(
  projectPath: string,
  options: { memory?: string; wrapperPid?: number } = {}
): Promise<CodexLaunchPreparation> {
  return prepareAgentLaunch("codex", projectPath, options);
}

export async function setCodexLaunchChildPid(
  projectPath: string,
  launchId: string,
  childPid: number
): Promise<CodexLaunchRecord> {
  return setAgentLaunchChildPid("codex", projectPath, launchId, childPid);
}

export async function registerCodexSessionStart(
  projectPath: string,
  event: Record<string, unknown>,
  launchId = process.env[CODEX_LAUNCH_ID_ENV]
): Promise<CodexSessionRegistrationResult> {
  return registerAgentSessionStart("codex", projectPath, event, launchId);
}

export async function checkpointCodexLaunch(
  projectPath: string,
  launchId: string
): Promise<CodexCheckpointResult> {
  return checkpointAgentLaunch("codex", projectPath, launchId);
}

export async function listCodexLaunches(projectPath: string): Promise<CodexLaunchRecord[]> {
  return listAgentLaunches("codex", projectPath);
}

export async function recoverCodexLaunches(
  projectPath: string
): Promise<CodexCheckpointResult[]> {
  return recoverAgentLaunches("codex", projectPath);
}

export async function discardCodexLaunch(
  projectPath: string,
  launchId: string
): Promise<void> {
  return discardAgentLaunch("codex", projectPath, launchId);
}

export async function launchCodexWithRecovery(
  options: CodexLauncherOptions
): Promise<CodexLauncherResult> {
  return launchAgentWithRecovery("codex", options);
}
