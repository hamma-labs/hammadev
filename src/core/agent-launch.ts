import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { constants as osConstants } from "node:os";
import path from "node:path";
import {
  checkpointMemory,
  inspectMemory,
  MemorySyncResult,
  MemoryWritebackResult,
  syncMemory,
} from "./memory.js";

// Shared launch-record runtime behind the native `hamma codex` and
// `hamma claude` wrappers. Each launch writes a record under
// `.hamma/runtime/<agent>/`, binds the exact child session id through the
// agent's native SessionStart hook, and checkpoints that exact session when
// the wrapper observes process termination — including crashes the agent's
// own SessionEnd hook can never see.

const LAUNCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const RUNTIME_SCHEMA_VERSION = 1 as const;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 100;
const LOCK_RETRY_MS = 20;

export type LaunchAgent = "codex" | "claude" | "grok";

const AGENT_LABELS: Record<LaunchAgent, string> = {
  codex: "Codex",
  claude: "Claude Code",
  grok: "Grok",
};

const LAUNCH_ID_ENV: Record<LaunchAgent, string> = {
  codex: "HAMMA_CODEX_LAUNCH_ID",
  claude: "HAMMA_CLAUDE_LAUNCH_ID",
  grok: "HAMMA_GROK_LAUNCH_ID",
};

export function launchAgentLabel(agent: LaunchAgent): string {
  return AGENT_LABELS[agent];
}

export function launchIdEnvVar(agent: LaunchAgent): string {
  return LAUNCH_ID_ENV[agent];
}

export type AgentLaunchState = "waiting" | "running" | "checkpointing" | "failed";

export interface AgentLaunchRecord {
  schemaVersion: 1;
  id: string;
  projectPath: string;
  memory: string;
  wrapperPid: number;
  wrapperIdentity?: string;
  childPid?: number;
  childIdentity?: string;
  sessionId?: string;
  state: AgentLaunchState;
  createdAt: string;
  updatedAt: string;
  checkpointAttempts: number;
  checkpointPid?: number;
  checkpointIdentity?: string;
  lastError?: string;
}

export interface AgentLaunchPreparation {
  enabled: boolean;
  reason?: string;
  launch?: AgentLaunchRecord;
}

export interface AgentSessionRegistrationResult {
  status: "registered" | "unmanaged" | "skipped";
  launchId?: string;
  sessionId?: string;
  reason?: string;
}

export interface AgentCheckpointResult {
  status: "updated" | "unchanged" | "active" | "pending" | "failed";
  agent: LaunchAgent;
  launchId: string;
  sessionId?: string;
  memory?: string;
  revision?: string;
  reason?: string;
}

export interface AgentLauncherOptions {
  projectPath: string;
  memory?: string;
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  wrapperPid?: number;
}

export interface AgentLauncherResult {
  exitCode: number;
  signal?: NodeJS.Signals;
  recoveryEnabled: boolean;
  setupWarning?: string;
  checkpoint?: AgentCheckpointResult;
}

interface CheckpointClaim {
  record: AgentLaunchRecord;
  claimed: boolean;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function assertSafeDirectory(directory: string, parent?: string): Promise<void> {
  const stats = await fs.lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Launch runtime directory is not a safe directory: ${directory}`);
  }
  const canonical = await fs.realpath(directory);
  if (canonical !== directory || (parent && !isWithin(parent, canonical))) {
    throw new Error(`Launch runtime directory contains symbolic-link components: ${directory}`);
  }
}

async function ensureSafeDirectory(directory: string, parent: string): Promise<void> {
  try {
    await fs.mkdir(directory);
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
  }
  await assertSafeDirectory(directory, parent);
}

async function runtimeRoot(agent: LaunchAgent, projectPath: string, create: boolean): Promise<string> {
  const project = path.resolve(projectPath);
  await assertSafeDirectory(project);
  const hammaRoot = path.join(project, ".hamma");
  await assertSafeDirectory(hammaRoot, project);
  const runtime = path.join(hammaRoot, "runtime");
  const agentRoot = path.join(runtime, agent);
  if (create) {
    await ensureSafeDirectory(runtime, hammaRoot);
    await ensureSafeDirectory(agentRoot, runtime);
  } else {
    await assertSafeDirectory(runtime, hammaRoot);
    await assertSafeDirectory(agentRoot, runtime);
  }
  return agentRoot;
}

function assertLaunchId(agent: LaunchAgent, id: string): void {
  if (!LAUNCH_ID.test(id)) throw new Error(`Invalid ${AGENT_LABELS[agent]} launch id '${id}'.`);
}

function assertSessionId(agent: LaunchAgent, id: string): void {
  if (!SESSION_ID.test(id)) {
    throw new Error(`${AGENT_LABELS[agent]} hook supplied an invalid session identifier.`);
  }
}

function recordPath(agent: LaunchAgent, root: string, launchId: string): string {
  assertLaunchId(agent, launchId);
  return path.join(root, `${launchId}.json`);
}

function validateRecord(agent: LaunchAgent, value: unknown, target: string): AgentLaunchRecord {
  if (!value || typeof value !== "object") {
    throw new Error(`Launch record is invalid: ${target}`);
  }
  const record = value as AgentLaunchRecord;
  assertLaunchId(agent, record.id);
  if (
    record.schemaVersion !== RUNTIME_SCHEMA_VERSION ||
    typeof record.projectPath !== "string" ||
    typeof record.memory !== "string" ||
    !Number.isInteger(record.wrapperPid) ||
    !["waiting", "running", "checkpointing", "failed"].includes(record.state) ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    !Number.isInteger(record.checkpointAttempts) ||
    (record.wrapperIdentity !== undefined && typeof record.wrapperIdentity !== "string") ||
    (record.childIdentity !== undefined && typeof record.childIdentity !== "string") ||
    (record.checkpointIdentity !== undefined && typeof record.checkpointIdentity !== "string")
  ) {
    throw new Error(`Launch record has unsupported metadata: ${target}`);
  }
  if (record.sessionId) assertSessionId(agent, record.sessionId);
  return record;
}

async function readRecord(agent: LaunchAgent, root: string, launchId: string): Promise<AgentLaunchRecord> {
  const target = recordPath(agent, root, launchId);
  const stats = await fs.lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Launch record is not a safe file: ${target}`);
  }
  const record = validateRecord(agent, JSON.parse(await fs.readFile(target, "utf8")), target);
  if (record.id !== launchId) {
    throw new Error(`Launch record id does not match its filename: ${target}`);
  }
  return record;
}

async function writeRecord(agent: LaunchAgent, root: string, record: AgentLaunchRecord): Promise<void> {
  const target = recordPath(agent, root, record.id);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function acquireRuntimeLock(root: string): Promise<string> {
  const lock = path.join(root, ".lock");
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      await fs.mkdir(lock);
      return lock;
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      try {
        const stats = await fs.lstat(lock);
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          throw new Error(`Launch runtime lock is not a safe directory: ${lock}`);
        }
        if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch (statError: any) {
        if (statError.code === "ENOENT") continue;
        throw statError;
      }
      await delay(LOCK_RETRY_MS);
    }
  }
  throw new Error("Timed out waiting for the launch runtime lock.");
}

async function withRuntimeLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const lock = await acquireRuntimeLock(root);
  try {
    return await work();
  } finally {
    await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
  }
}

function processAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error.code === "EPERM";
  }
}

async function processIdentity(pid: number | undefined): Promise<string | undefined> {
  if (process.platform !== "linux" || !pid || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  try {
    const [bootId, stat] = await Promise.all([
      fs.readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      fs.readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return undefined;
    // Fields after the command name begin with field 3 (state). Linux procfs
    // field 22 is the process start time, so it is index 19 in this suffix.
    const suffix = stat.slice(closeParen + 1).trim().split(/\s+/);
    const startTime = suffix[19];
    if (!startTime) return undefined;
    return `linux:${bootId.trim()}:${startTime}`;
  } catch {
    return undefined;
  }
}

async function sameLiveProcess(
  pid: number | undefined,
  expectedIdentity: string | undefined
): Promise<boolean> {
  if (!processAlive(pid)) return false;
  if (!expectedIdentity) return true;
  const currentIdentity = await processIdentity(pid);
  // If procfs becomes unavailable, preserve the conservative PID-only result.
  return currentIdentity ? currentIdentity === expectedIdentity : true;
}

function missingMemory(error: unknown): boolean {
  const value = error as NodeJS.ErrnoException;
  return value.code === "ENOENT" || String(value.message).includes("No active project memory");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkpointExactSession(
  agent: LaunchAgent,
  projectPath: string,
  memory: string,
  sessionId: string
): Promise<MemorySyncResult | MemoryWritebackResult> {
  const label = AGENT_LABELS[agent];
  const inspection = await inspectMemory(projectPath, memory);
  if (inspection.openRuns.length > 1) {
    throw new Error(
      `Memory '${memory}' has multiple open attach claims; automatic ${label} recovery cannot choose one.`
    );
  }
  const openRun = inspection.openRuns[0];
  const source = `${agent}:${sessionId}`;
  if (openRun) {
    if (openRun.targetCli !== agent) {
      throw new Error(
        `Memory '${memory}' is currently attached to ${openRun.targetCli}; ${label} recovery was deferred.`
      );
    }
    return checkpointMemory(projectPath, memory, openRun.id, {
      source,
      useGitignore: false,
    });
  }
  return syncMemory(projectPath, memory, {
    source,
    useGitignore: false,
    lifecycleHook: true,
  });
}

export async function prepareAgentLaunch(
  agent: LaunchAgent,
  projectPath: string,
  options: { memory?: string; wrapperPid?: number } = {}
): Promise<AgentLaunchPreparation> {
  const project = path.resolve(projectPath);
  let memory: string;
  try {
    memory = (await inspectMemory(project, options.memory)).manifest.name;
  } catch (error) {
    if (missingMemory(error)) {
      return {
        enabled: false,
        reason: "No active project memory; exit recovery is disabled until `hamma save` or `hamma switch` enables it.",
      };
    }
    throw error;
  }

  const root = await runtimeRoot(agent, project, true);
  const now = new Date().toISOString();
  const record: AgentLaunchRecord = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    id: randomUUID(),
    projectPath: project,
    memory,
    wrapperPid: options.wrapperPid ?? process.pid,
    wrapperIdentity: await processIdentity(options.wrapperPid ?? process.pid),
    state: "waiting",
    createdAt: now,
    updatedAt: now,
    checkpointAttempts: 0,
  };
  await withRuntimeLock(root, () => writeRecord(agent, root, record));
  return { enabled: true, launch: record };
}

export async function setAgentLaunchChildPid(
  agent: LaunchAgent,
  projectPath: string,
  launchId: string,
  childPid: number
): Promise<AgentLaunchRecord> {
  if (!Number.isInteger(childPid) || childPid <= 0) {
    throw new Error(`${AGENT_LABELS[agent]} launcher did not receive a valid child process id.`);
  }
  const root = await runtimeRoot(agent, path.resolve(projectPath), false);
  const childIdentity = await processIdentity(childPid);
  return withRuntimeLock(root, async () => {
    const record = await readRecord(agent, root, launchId);
    const updated: AgentLaunchRecord = {
      ...record,
      childPid,
      childIdentity,
      state: "running",
      updatedAt: new Date().toISOString(),
    };
    await writeRecord(agent, root, updated);
    return updated;
  });
}

export async function registerAgentSessionStart(
  agent: LaunchAgent,
  projectPath: string,
  event: Record<string, unknown>,
  launchId = process.env[LAUNCH_ID_ENV[agent]]
): Promise<AgentSessionRegistrationResult> {
  if (!launchId) {
    return {
      status: "unmanaged",
      reason: `${AGENT_LABELS[agent]} was not launched through \`hamma ${agent}\`.`,
    };
  }
  assertLaunchId(agent, launchId);
  const rawSessionId = event.session_id ?? event.sessionId;
  if (typeof rawSessionId !== "string" || !rawSessionId.trim()) {
    return { status: "skipped", launchId, reason: "SessionStart did not include a session id." };
  }
  const sessionId = rawSessionId.trim();
  assertSessionId(agent, sessionId);
  const project = path.resolve(projectPath);
  const root = await runtimeRoot(agent, project, false);
  return withRuntimeLock(root, async () => {
    const record = await readRecord(agent, root, launchId);
    if (record.projectPath !== project) {
      throw new Error(`${AGENT_LABELS[agent]} launch record belongs to a different project.`);
    }
    if (record.sessionId && record.sessionId !== sessionId) {
      throw new Error(
        `${AGENT_LABELS[agent]} launch ${launchId} is already bound to session ${record.sessionId}; refusing session ${sessionId}.`
      );
    }
    const updated: AgentLaunchRecord = {
      ...record,
      sessionId,
      state: record.state === "waiting" ? "running" : record.state,
      updatedAt: new Date().toISOString(),
      lastError: undefined,
    };
    await writeRecord(agent, root, updated);
    return { status: "registered", launchId, sessionId };
  });
}

async function claimCheckpoint(
  agent: LaunchAgent,
  root: string,
  launchId: string
): Promise<CheckpointClaim> {
  return withRuntimeLock(root, async () => {
    const record = await readRecord(agent, root, launchId);
    if (
      record.state === "checkpointing" &&
      record.checkpointPid !== process.pid &&
      await sameLiveProcess(record.checkpointPid, record.checkpointIdentity)
    ) {
      return { record, claimed: false };
    }
    const claimed: AgentLaunchRecord = {
      ...record,
      state: "checkpointing",
      checkpointPid: process.pid,
      checkpointIdentity: await processIdentity(process.pid),
      checkpointAttempts: record.checkpointAttempts + 1,
      updatedAt: new Date().toISOString(),
      lastError: undefined,
    };
    await writeRecord(agent, root, claimed);
    return { record: claimed, claimed: true };
  });
}

async function failCheckpoint(
  agent: LaunchAgent,
  root: string,
  record: AgentLaunchRecord,
  error: unknown
): Promise<void> {
  await withRuntimeLock(root, async () => {
    let current: AgentLaunchRecord;
    try {
      current = await readRecord(agent, root, record.id);
    } catch (readError: any) {
      if (readError.code === "ENOENT") return;
      throw readError;
    }
    await writeRecord(agent, root, {
      ...current,
      state: "failed",
      checkpointPid: undefined,
      checkpointIdentity: undefined,
      updatedAt: new Date().toISOString(),
      lastError: errorMessage(error).slice(0, 1000),
    });
  });
}

export async function checkpointAgentLaunch(
  agent: LaunchAgent,
  projectPath: string,
  launchId: string
): Promise<AgentCheckpointResult> {
  const project = path.resolve(projectPath);
  let root: string;
  try {
    root = await runtimeRoot(agent, project, false);
  } catch (error: any) {
    return {
      status: "failed",
      agent,
      launchId,
      reason: errorMessage(error),
    };
  }

  let claim: CheckpointClaim;
  try {
    claim = await claimCheckpoint(agent, root, launchId);
  } catch (error: any) {
    return { status: "failed", agent, launchId, reason: errorMessage(error) };
  }
  const record = claim.record;
  if (!claim.claimed) {
    return {
      status: "active",
      agent,
      launchId,
      sessionId: record.sessionId,
      memory: record.memory,
      reason: `Another process is already checkpointing this ${AGENT_LABELS[agent]} launch.`,
    };
  }
  if (!record.sessionId) {
    const reason = `${AGENT_LABELS[agent]} SessionStart did not bind an exact session; review and trust the Hamma hooks with \`/hooks\`.`;
    await failCheckpoint(agent, root, record, new Error(reason));
    return { status: "pending", agent, launchId, memory: record.memory, reason };
  }

  try {
    const result = await checkpointExactSession(agent, project, record.memory, record.sessionId);
    await withRuntimeLock(root, async () => {
      await fs.rm(recordPath(agent, root, launchId), { force: true });
    });
    return {
      status: result.updated ? "updated" : "unchanged",
      agent,
      launchId,
      sessionId: record.sessionId,
      memory: result.memory,
      revision: result.revision?.id,
      reason: result.reason,
    };
  } catch (error) {
    await failCheckpoint(agent, root, record, error);
    return {
      status: "pending",
      agent,
      launchId,
      sessionId: record.sessionId,
      memory: record.memory,
      reason: errorMessage(error),
    };
  }
}

export async function listAgentLaunches(
  agent: LaunchAgent,
  projectPath: string
): Promise<AgentLaunchRecord[]> {
  let root: string;
  try {
    root = await runtimeRoot(agent, path.resolve(projectPath), false);
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const records: AgentLaunchRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const launchId = entry.name.slice(0, -".json".length);
    if (!LAUNCH_ID.test(launchId)) continue;
    records.push(await readRecord(agent, root, launchId));
  }
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function recoverAgentLaunches(
  agent: LaunchAgent,
  projectPath: string
): Promise<AgentCheckpointResult[]> {
  const project = path.resolve(projectPath);
  let records: AgentLaunchRecord[];
  try {
    records = await listAgentLaunches(agent, project);
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const results: AgentCheckpointResult[] = [];
  for (const record of records) {
    if (
      await sameLiveProcess(record.childPid, record.childIdentity) ||
      await sameLiveProcess(record.wrapperPid, record.wrapperIdentity) ||
      (record.state === "checkpointing" &&
        await sameLiveProcess(record.checkpointPid, record.checkpointIdentity))
    ) {
      results.push({
        status: "active",
        agent,
        launchId: record.id,
        sessionId: record.sessionId,
        memory: record.memory,
        reason: `The ${AGENT_LABELS[agent]} wrapper or child process is still running.`,
      });
      continue;
    }
    results.push(await checkpointAgentLaunch(agent, project, record.id));
  }
  return results;
}

export async function discardAgentLaunch(
  agent: LaunchAgent,
  projectPath: string,
  launchId: string
): Promise<void> {
  let root: string;
  try {
    root = await runtimeRoot(agent, path.resolve(projectPath), false);
  } catch (error: any) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await withRuntimeLock(root, () => fs.rm(recordPath(agent, root, launchId), { force: true }));
}

function signalExitCode(signal: NodeJS.Signals | undefined): number {
  if (!signal) return 1;
  return 128 + (osConstants.signals[signal] ?? 0);
}

export async function launchAgentWithRecovery(
  agent: LaunchAgent,
  options: AgentLauncherOptions
): Promise<AgentLauncherResult> {
  const project = path.resolve(options.projectPath);
  const command = options.command ?? agent;
  const args = options.args ?? [];
  let preparation: AgentLaunchPreparation;
  let setupWarning: string | undefined;
  try {
    preparation = await prepareAgentLaunch(agent, project, {
      memory: options.memory,
      wrapperPid: options.wrapperPid,
    });
  } catch (error) {
    preparation = { enabled: false };
    setupWarning = `Hamma exit recovery could not start: ${errorMessage(error)}`;
  }
  if (!preparation.enabled && preparation.reason) setupWarning = preparation.reason;

  const launch = preparation.launch;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    HAMMA_AGENT: agent,
    ...(launch ? { [LAUNCH_ID_ENV[agent]]: launch.id } : {}),
  };

  const child = spawn(command, args, {
    cwd: project,
    stdio: "inherit",
    env: childEnv,
  });

  // Attach error/close listeners before any awaited registration work. A
  // missing executable can emit `error` on the next tick.
  const childOutcome = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    }
  );

  const forwardedSignals: NodeJS.Signals[] = process.platform === "win32"
    ? ["SIGINT", "SIGTERM"]
    : ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of forwardedSignals) {
    const handler = () => {
      if (!child.killed) {
        try {
          child.kill(signal);
        } catch {
          // The child may have closed between the killed check and delivery.
        }
      }
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    if (launch && child.pid) {
      try {
        await setAgentLaunchChildPid(agent, project, launch.id, child.pid);
      } catch (error) {
        setupWarning = `Hamma could not register the ${AGENT_LABELS[agent]} child process: ${errorMessage(error)}`;
      }
    }

    const outcome = await childOutcome;
    const checkpoint = launch
      ? await checkpointAgentLaunch(agent, project, launch.id)
      : undefined;
    return {
      exitCode: outcome.code ?? signalExitCode(outcome.signal ?? undefined),
      signal: outcome.signal ?? undefined,
      recoveryEnabled: Boolean(launch),
      setupWarning,
      checkpoint,
    };
  } catch (error) {
    if (launch) await discardAgentLaunch(agent, project, launch.id).catch(() => undefined);
    throw error;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}
