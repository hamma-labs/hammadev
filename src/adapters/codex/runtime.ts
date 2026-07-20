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
} from "../../core/memory.js";

const LAUNCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const RUNTIME_SCHEMA_VERSION = 1 as const;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 100;
const LOCK_RETRY_MS = 20;

export const CODEX_LAUNCH_ID_ENV = "HAMMA_CODEX_LAUNCH_ID";

export type CodexLaunchState = "waiting" | "running" | "checkpointing" | "failed";

export interface CodexLaunchRecord {
  schemaVersion: 1;
  id: string;
  projectPath: string;
  memory: string;
  wrapperPid: number;
  wrapperIdentity?: string;
  childPid?: number;
  childIdentity?: string;
  sessionId?: string;
  state: CodexLaunchState;
  createdAt: string;
  updatedAt: string;
  checkpointAttempts: number;
  checkpointPid?: number;
  checkpointIdentity?: string;
  lastError?: string;
}

export interface CodexLaunchPreparation {
  enabled: boolean;
  reason?: string;
  launch?: CodexLaunchRecord;
}

export interface CodexSessionRegistrationResult {
  status: "registered" | "unmanaged" | "skipped";
  launchId?: string;
  sessionId?: string;
  reason?: string;
}

export interface CodexCheckpointResult {
  status: "updated" | "unchanged" | "active" | "pending" | "failed";
  launchId: string;
  sessionId?: string;
  memory?: string;
  revision?: string;
  reason?: string;
}

export interface CodexLauncherOptions {
  projectPath: string;
  memory?: string;
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  wrapperPid?: number;
}

export interface CodexLauncherResult {
  exitCode: number;
  signal?: NodeJS.Signals;
  recoveryEnabled: boolean;
  setupWarning?: string;
  checkpoint?: CodexCheckpointResult;
}

interface CheckpointClaim {
  record: CodexLaunchRecord;
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
    throw new Error(`Codex runtime directory is not a safe directory: ${directory}`);
  }
  const canonical = await fs.realpath(directory);
  if (canonical !== directory || (parent && !isWithin(parent, canonical))) {
    throw new Error(`Codex runtime directory contains symbolic-link components: ${directory}`);
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

async function runtimeRoot(projectPath: string, create: boolean): Promise<string> {
  const project = path.resolve(projectPath);
  await assertSafeDirectory(project);
  const hammaRoot = path.join(project, ".hamma");
  await assertSafeDirectory(hammaRoot, project);
  const runtime = path.join(hammaRoot, "runtime");
  const codex = path.join(runtime, "codex");
  if (create) {
    await ensureSafeDirectory(runtime, hammaRoot);
    await ensureSafeDirectory(codex, runtime);
  } else {
    await assertSafeDirectory(runtime, hammaRoot);
    await assertSafeDirectory(codex, runtime);
  }
  return codex;
}

function assertLaunchId(id: string): void {
  if (!LAUNCH_ID.test(id)) throw new Error(`Invalid Codex launch id '${id}'.`);
}

function assertSessionId(id: string): void {
  if (!SESSION_ID.test(id)) throw new Error("Codex hook supplied an invalid session identifier.");
}

function recordPath(root: string, launchId: string): string {
  assertLaunchId(launchId);
  return path.join(root, `${launchId}.json`);
}

function validateRecord(value: unknown, target: string): CodexLaunchRecord {
  if (!value || typeof value !== "object") {
    throw new Error(`Codex launch record is invalid: ${target}`);
  }
  const record = value as CodexLaunchRecord;
  assertLaunchId(record.id);
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
    throw new Error(`Codex launch record has unsupported metadata: ${target}`);
  }
  if (record.sessionId) assertSessionId(record.sessionId);
  return record;
}

async function readRecord(root: string, launchId: string): Promise<CodexLaunchRecord> {
  const target = recordPath(root, launchId);
  const stats = await fs.lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Codex launch record is not a safe file: ${target}`);
  }
  const record = validateRecord(JSON.parse(await fs.readFile(target, "utf8")), target);
  if (record.id !== launchId) {
    throw new Error(`Codex launch record id does not match its filename: ${target}`);
  }
  return record;
}

async function writeRecord(root: string, record: CodexLaunchRecord): Promise<void> {
  const target = recordPath(root, record.id);
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
          throw new Error(`Codex runtime lock is not a safe directory: ${lock}`);
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
  throw new Error("Timed out waiting for the Codex runtime lock.");
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
  projectPath: string,
  memory: string,
  sessionId: string
): Promise<MemorySyncResult | MemoryWritebackResult> {
  const inspection = await inspectMemory(projectPath, memory);
  if (inspection.openRuns.length > 1) {
    throw new Error(
      `Memory '${memory}' has multiple open attach claims; automatic Codex recovery cannot choose one.`
    );
  }
  const openRun = inspection.openRuns[0];
  const source = `codex:${sessionId}`;
  if (openRun) {
    if (openRun.targetCli !== "codex") {
      throw new Error(
        `Memory '${memory}' is currently attached to ${openRun.targetCli}; Codex recovery was deferred.`
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

export async function prepareCodexLaunch(
  projectPath: string,
  options: { memory?: string; wrapperPid?: number } = {}
): Promise<CodexLaunchPreparation> {
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

  const root = await runtimeRoot(project, true);
  const now = new Date().toISOString();
  const record: CodexLaunchRecord = {
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
  await withRuntimeLock(root, () => writeRecord(root, record));
  return { enabled: true, launch: record };
}

export async function setCodexLaunchChildPid(
  projectPath: string,
  launchId: string,
  childPid: number
): Promise<CodexLaunchRecord> {
  if (!Number.isInteger(childPid) || childPid <= 0) {
    throw new Error("Codex launcher did not receive a valid child process id.");
  }
  const root = await runtimeRoot(path.resolve(projectPath), false);
  const childIdentity = await processIdentity(childPid);
  return withRuntimeLock(root, async () => {
    const record = await readRecord(root, launchId);
    const updated: CodexLaunchRecord = {
      ...record,
      childPid,
      childIdentity,
      state: "running",
      updatedAt: new Date().toISOString(),
    };
    await writeRecord(root, updated);
    return updated;
  });
}

export async function registerCodexSessionStart(
  projectPath: string,
  event: Record<string, unknown>,
  launchId = process.env[CODEX_LAUNCH_ID_ENV]
): Promise<CodexSessionRegistrationResult> {
  if (!launchId) {
    return { status: "unmanaged", reason: "Codex was not launched through `hamma codex`." };
  }
  assertLaunchId(launchId);
  const rawSessionId = event.session_id ?? event.sessionId;
  if (typeof rawSessionId !== "string" || !rawSessionId.trim()) {
    return { status: "skipped", launchId, reason: "SessionStart did not include a session id." };
  }
  const sessionId = rawSessionId.trim();
  assertSessionId(sessionId);
  const project = path.resolve(projectPath);
  const root = await runtimeRoot(project, false);
  return withRuntimeLock(root, async () => {
    const record = await readRecord(root, launchId);
    if (record.projectPath !== project) {
      throw new Error("Codex launch record belongs to a different project.");
    }
    if (record.sessionId && record.sessionId !== sessionId) {
      throw new Error(
        `Codex launch ${launchId} is already bound to session ${record.sessionId}; refusing session ${sessionId}.`
      );
    }
    const updated: CodexLaunchRecord = {
      ...record,
      sessionId,
      state: record.state === "waiting" ? "running" : record.state,
      updatedAt: new Date().toISOString(),
      lastError: undefined,
    };
    await writeRecord(root, updated);
    return { status: "registered", launchId, sessionId };
  });
}

async function claimCheckpoint(
  root: string,
  launchId: string
): Promise<CheckpointClaim> {
  return withRuntimeLock(root, async () => {
    const record = await readRecord(root, launchId);
    if (
      record.state === "checkpointing" &&
      record.checkpointPid !== process.pid &&
      await sameLiveProcess(record.checkpointPid, record.checkpointIdentity)
    ) {
      return { record, claimed: false };
    }
    const claimed: CodexLaunchRecord = {
      ...record,
      state: "checkpointing",
      checkpointPid: process.pid,
      checkpointIdentity: await processIdentity(process.pid),
      checkpointAttempts: record.checkpointAttempts + 1,
      updatedAt: new Date().toISOString(),
      lastError: undefined,
    };
    await writeRecord(root, claimed);
    return { record: claimed, claimed: true };
  });
}

async function failCheckpoint(
  root: string,
  record: CodexLaunchRecord,
  error: unknown
): Promise<void> {
  await withRuntimeLock(root, async () => {
    let current: CodexLaunchRecord;
    try {
      current = await readRecord(root, record.id);
    } catch (readError: any) {
      if (readError.code === "ENOENT") return;
      throw readError;
    }
    await writeRecord(root, {
      ...current,
      state: "failed",
      checkpointPid: undefined,
      checkpointIdentity: undefined,
      updatedAt: new Date().toISOString(),
      lastError: errorMessage(error).slice(0, 1000),
    });
  });
}

export async function checkpointCodexLaunch(
  projectPath: string,
  launchId: string
): Promise<CodexCheckpointResult> {
  const project = path.resolve(projectPath);
  let root: string;
  try {
    root = await runtimeRoot(project, false);
  } catch (error: any) {
    return {
      status: "failed",
      launchId,
      reason: errorMessage(error),
    };
  }

  let claim: CheckpointClaim;
  try {
    claim = await claimCheckpoint(root, launchId);
  } catch (error: any) {
    return { status: "failed", launchId, reason: errorMessage(error) };
  }
  const record = claim.record;
  if (!claim.claimed) {
    return {
      status: "active",
      launchId,
      sessionId: record.sessionId,
      memory: record.memory,
      reason: "Another process is already checkpointing this Codex launch.",
    };
  }
  if (!record.sessionId) {
    const reason = "Codex SessionStart did not bind an exact session; review and trust the Hamma hooks with `/hooks`.";
    await failCheckpoint(root, record, new Error(reason));
    return { status: "pending", launchId, memory: record.memory, reason };
  }

  try {
    const result = await checkpointExactSession(project, record.memory, record.sessionId);
    await withRuntimeLock(root, async () => {
      await fs.rm(recordPath(root, launchId), { force: true });
    });
    return {
      status: result.updated ? "updated" : "unchanged",
      launchId,
      sessionId: record.sessionId,
      memory: result.memory,
      revision: result.revision?.id,
      reason: result.reason,
    };
  } catch (error) {
    await failCheckpoint(root, record, error);
    return {
      status: "pending",
      launchId,
      sessionId: record.sessionId,
      memory: record.memory,
      reason: errorMessage(error),
    };
  }
}

export async function listCodexLaunches(projectPath: string): Promise<CodexLaunchRecord[]> {
  let root: string;
  try {
    root = await runtimeRoot(path.resolve(projectPath), false);
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const records: CodexLaunchRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const launchId = entry.name.slice(0, -".json".length);
    if (!LAUNCH_ID.test(launchId)) continue;
    records.push(await readRecord(root, launchId));
  }
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function recoverCodexLaunches(
  projectPath: string
): Promise<CodexCheckpointResult[]> {
  const project = path.resolve(projectPath);
  let records: CodexLaunchRecord[];
  try {
    records = await listCodexLaunches(project);
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const results: CodexCheckpointResult[] = [];
  for (const record of records) {
    if (
      await sameLiveProcess(record.childPid, record.childIdentity) ||
      await sameLiveProcess(record.wrapperPid, record.wrapperIdentity) ||
      (record.state === "checkpointing" &&
        await sameLiveProcess(record.checkpointPid, record.checkpointIdentity))
    ) {
      results.push({
        status: "active",
        launchId: record.id,
        sessionId: record.sessionId,
        memory: record.memory,
        reason: "The Codex wrapper or child process is still running.",
      });
      continue;
    }
    results.push(await checkpointCodexLaunch(project, record.id));
  }
  return results;
}

export async function discardCodexLaunch(
  projectPath: string,
  launchId: string
): Promise<void> {
  let root: string;
  try {
    root = await runtimeRoot(path.resolve(projectPath), false);
  } catch (error: any) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await withRuntimeLock(root, () => fs.rm(recordPath(root, launchId), { force: true }));
}

function signalExitCode(signal: NodeJS.Signals | undefined): number {
  if (!signal) return 1;
  return 128 + (osConstants.signals[signal] ?? 0);
}

export async function launchCodexWithRecovery(
  options: CodexLauncherOptions
): Promise<CodexLauncherResult> {
  const project = path.resolve(options.projectPath);
  const command = options.command ?? "codex";
  const args = options.args ?? [];
  let preparation: CodexLaunchPreparation;
  let setupWarning: string | undefined;
  try {
    preparation = await prepareCodexLaunch(project, {
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
    HAMMA_AGENT: "codex",
    ...(launch ? { [CODEX_LAUNCH_ID_ENV]: launch.id } : {}),
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
        await setCodexLaunchChildPid(project, launch.id, child.pid);
      } catch (error) {
        setupWarning = `Hamma could not register the Codex child process: ${errorMessage(error)}`;
      }
    }

    const outcome = await childOutcome;
    const checkpoint = launch
      ? await checkpointCodexLaunch(project, launch.id)
      : undefined;
    return {
      exitCode: outcome.code ?? signalExitCode(outcome.signal ?? undefined),
      signal: outcome.signal ?? undefined,
      recoveryEnabled: Boolean(launch),
      setupWarning,
      checkpoint,
    };
  } catch (error) {
    if (launch) await discardCodexLaunch(project, launch.id).catch(() => undefined);
    throw error;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}
