import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { loadSession } from "../session-loader.js";
import { INITIAL_CONTEXT_MAX_BYTES, INITIAL_CONTEXT_TARGET_BYTES, measureNormalizedSourceBytes } from "./artifact-policy.js";
import { normalizeFilesMentioned } from "./files.js";
import {
  captureGitRepositorySnapshot,
  compareRepositorySnapshots,
  RepositoryDriftCategory,
  RepositoryDriftResult,
} from "./git-snapshot.js";
import { computeRepoState, ensureGitignore, renderHandoffWithSizeGuard, renderToolHistoryJsonl } from "./handoff.js";
import {
  ArchivedMemoryMessage,
  conversationDelta,
  deriveMemoryUpdate,
  emptyMemoryState,
  HammaMemoryState,
  HammaMemoryRun,
  HammaMemoryUpdate,
  HammaTaskEpoch,
  mergeMemoryKnowledge,
  MemoryProvenance,
  renderMemoryBootstrap,
  sourceCursorKey,
  taskEpochBoundary,
  taskEpochId,
  validateMemoryUpdate,
} from "./memory-state.js";
import { scoreSession } from "./quality.js";
import { assessHandoffReadiness, HandoffReadinessResult } from "./readiness.js";
import { redactText } from "./redact.js";
import { HammaSession } from "./schema.js";
import { extractTaskState, HammaEvidenceItem, HammaTaskLedgerItem, HammaTaskState } from "./state.js";

const MEMORY_SCHEMA_VERSION = 2 as const;
const DEFAULT_MEMORY_NAME = "default";
const MEMORY_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REVISION_ID = /^\d{6}-\d{4}-\d{2}-\d{2}T[0-9-]+Z-[a-z0-9_-]+$/;
const ATTACH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECALL_MAX_OUTPUT_BYTES = 32 * 1024;
const MEMORY_LOCK_STALE_MS = 5 * 60 * 1000;
const MEMORY_LOCK_RETRIES = 3;
const MEMORY_LOCK_RETRY_MS = 500;

export type MemoryFaultStage =
  | "after-lock-acquired"
  | "after-revision-files-written"
  | "after-revision-published";

export interface MemoryRevisionSummary {
  id: string;
  parentRevision?: string;
  createdAt: string;
  sourceCli: string;
  sourceSessionId?: string;
  sourceLastUpdatedAt?: string;
  sourceContentFingerprint?: string;
  sourceFingerprint: string;
  driftFromParent: RepositoryDriftCategory[];
  warnings: string[];
  kind?: "sync" | "correction";
  correction?: {
    action: "repair" | "close";
    reason: string;
    fields: Array<"goal" | "outcome" | "nextAction">;
  };
}

export interface ProjectMemoryManifest {
  schemaVersion: 1 | 2;
  name: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  goal?: string;
  latestRevision?: string;
  revisionCount: number;
  revisions: MemoryRevisionSummary[];
}

export interface MemoryListEntry {
  name: string;
  active: boolean;
  schemaVersion: 1 | 2;
  revisionCount: number;
  updatedAt: string;
  latestRevision?: string;
  sourceCli?: string;
  nextAction?: string;
  outcome?: HammaTaskState["outcome"];
  openAttachId?: string;
  openAttachTarget?: string;
}

interface LatestMemoryRevision {
  revision: MemoryRevisionSummary;
  path: string;
  state: HammaTaskState;
  memoryState: HammaMemoryState;
  compatibilityView: boolean;
}

export interface MemoryInspection {
  schemaVersion: 2;
  active: boolean;
  compatibilityView: boolean;
  manifest: ProjectMemoryManifest;
  openRuns: HammaMemoryRun[];
  latest?: {
    revision: MemoryRevisionSummary;
    revisionPath: string;
    state: HammaTaskState;
    memoryState: HammaMemoryState;
    bootstrapPath: string;
    drift: RepositoryDriftResult;
    readiness: HandoffReadinessResult;
  };
}

export interface MemorySyncOptions {
  source?: string;
  updateFile?: string;
  update?: HammaMemoryUpdate;
  useGitignore?: boolean;
  lifecycleHook?: boolean;
  attachId?: string;
  forcedOutcome?: HammaTaskState["outcome"];
  forcedNextAction?: string | null;
  /** Deterministic test-only fault hook; production callers should omit it. */
  faultInjector?: (stage: MemoryFaultStage) => void | Promise<void>;
}

export interface MemorySyncResult {
  schemaVersion: 2;
  updated: boolean;
  memory: string;
  projectPath: string;
  revision?: MemoryRevisionSummary;
  revisionPath?: string;
  bootstrapPath?: string;
  memoryStatePath?: string;
  statePath?: string;
  handoffPath?: string;
  conversationPath?: string;
  toolHistoryPath?: string;
  contextBudget?: {
    initialArtifacts: ["bootstrap.md"];
    bytes: number;
    maxBytes: number;
    withinBudget: boolean;
    sourceBytes: number;
    continuationLargerThanSource: boolean;
  };
  selection: {
    mode: "explicit" | "automatic";
    sourceCli?: string;
    sourceSessionId?: string;
    explanation: string[];
  };
  warnings: string[];
  reason?: string;
}

export interface MemoryRepairOptions {
  goal?: string;
  outcome?: HammaTaskState["outcome"];
  nextAction?: string | null;
  reason: string;
}

export interface MemoryCorrectionResult {
  schemaVersion: 2;
  memory: string;
  projectPath: string;
  action: "repair" | "close";
  revision: MemoryRevisionSummary;
  revisionPath: string;
  bootstrapPath: string;
  memoryStatePath: string;
  statePath: string;
  handoffPath: string;
  previous: {
    outcome: HammaTaskState["outcome"];
    goal?: string;
    nextAction?: string;
  };
  current: {
    outcome: HammaTaskState["outcome"];
    goal?: string;
    nextAction?: string;
  };
}

export type MemoryExecutionMode =
  | "continue_work"
  | "ready_for_input"
  | "needs_instruction"
  | "blocked"
  | "review_required";

export interface MemoryAttachOptions {
  source?: string;
  noSync?: boolean;
  useGitignore?: boolean;
}

export interface MemoryAttachResult {
  schemaVersion: 2;
  memory: string;
  targetCli: string;
  projectPath: string;
  revision: string;
  memoryLoadAllowed: boolean;
  autoExecuteAllowed: boolean;
  executionMode: MemoryExecutionMode;
  previousOutcome: HammaTaskState["outcome"];
  bootstrapPath: string;
  supportingPaths: { memoryStatePath: string; statePath: string; handoffPath: string; conversationPath?: string };
  statePath: string;
  handoffPath: string;
  toolHistoryPath: string;
  drift: RepositoryDriftResult;
  readiness: HandoffReadinessResult;
  syncStatus: "updated" | "unchanged" | "skipped" | "warning";
  syncRevision?: string;
  attachId?: string;
  run?: HammaMemoryRun;
  warnings: string[];
  contextBudget: {
    initialArtifacts: ["bootstrap.md"] | ["handoff.md"];
    bytes: number;
    launchPromptBytes: number;
    combinedBytes: number;
    maxBytes: number;
    withinBudget: boolean;
  };
  launch: { command: string; args: string[] };
  suggestedCommand: string;
}

export interface MemoryWritebackOptions {
  source: string;
  updateFile?: string;
  update?: HammaMemoryUpdate;
  useGitignore?: boolean;
}

export interface MemoryFinishOptions extends MemoryWritebackOptions {
  outcome?: "completed" | "blocked";
  nextAction?: string;
}

export interface MemoryWritebackResult extends MemorySyncResult {
  attachId: string;
  run: HammaMemoryRun;
}

export interface MemoryResumeResult extends Omit<MemoryAttachResult, "schemaVersion"> {
  schemaVersion: 1;
  resumeAllowed: boolean;
}

export interface MemoryRecallResultItem {
  kind: "knowledge" | "conversation" | "epoch";
  score: number;
  content: string;
  category?: string;
  files?: string[];
  sourceCli?: string;
  sourceSessionId?: string;
  timestamp?: string;
  revision?: string;
}

export interface MemoryRecallResult {
  schemaVersion: 2;
  memory: string;
  query: string;
  limit: number;
  results: MemoryRecallResultItem[];
  truncated: boolean;
}

function assertMemoryName(name: string): void {
  if (!MEMORY_NAME.test(name)) throw new Error(`Invalid memory name '${name}'. Use 1-64 lowercase letters, numbers, underscores, or hyphens.`);
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function assertSafeDirectory(directory: string, parent?: string): Promise<void> {
  const stats = await fs.lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Memory storage directory is not a safe directory: ${directory}`);
  const canonical = await fs.realpath(directory);
  if (canonical !== directory || (parent && !isWithin(parent, canonical))) throw new Error(`Memory storage contains symbolic-link components: ${directory}`);
}

async function canonicalProject(projectPath: string): Promise<string> {
  const resolved = path.resolve(projectPath);
  const stats = await fs.lstat(resolved);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Memory project root is not a safe directory: ${resolved}`);
  }
  return fs.realpath(resolved);
}

export function resolveMemoryProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  try {
    return path.resolve(execFileSync("git", ["-C", resolved, "rev-parse", "--show-toplevel"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).trim());
  } catch {
    return resolved;
  }
}

async function ensureDirectory(directory: string, parent: string): Promise<void> {
  try { await fs.mkdir(directory); } catch (error: any) { if (error.code !== "EEXIST") throw error; }
  await assertSafeDirectory(directory, parent);
}

async function storeRoot(projectPath: string, create: boolean): Promise<string> {
  const project = await canonicalProject(projectPath);
  const hammaRoot = path.join(project, ".hamma");
  const memoriesRoot = path.join(hammaRoot, "memories");
  if (create) {
    await ensureDirectory(hammaRoot, project);
    await ensureDirectory(memoriesRoot, project);
  } else {
    await assertSafeDirectory(hammaRoot, project);
    await assertSafeDirectory(memoriesRoot, project);
  }
  return memoriesRoot;
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try { await fs.rename(temporary, target); } catch (error) { await fs.rm(temporary, { force: true }).catch(() => undefined); throw error; }
}

async function readJson<T>(target: string): Promise<T> {
  const stats = await fs.lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Memory metadata is not a safe file: ${target}`);
  return JSON.parse(await fs.readFile(target, "utf8")) as T;
}

async function readUpdateFile(target: string): Promise<HammaMemoryUpdate> {
  const resolved = path.resolve(target);
  const stats = await fs.lstat(resolved);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Memory update is not a safe regular file: ${resolved}`);
  if (stats.size > 1024 * 1024) throw new Error("Memory update exceeds the 1 MiB input limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(await fs.readFile(resolved, "utf8")); } catch (error: any) { throw new Error(`Invalid memory update JSON: ${error.message}`); }
  return validateMemoryUpdate(parsed);
}

function memoryPath(root: string, name: string): string { assertMemoryName(name); return path.join(root, name); }

async function activeMemoryName(root: string): Promise<string | undefined> {
  try {
    const active = await readJson<{ name?: string }>(path.join(root, "active.json"));
    if (!active.name) return undefined;
    assertMemoryName(active.name);
    return active.name;
  } catch (error: any) { if (error.code === "ENOENT") return undefined; throw error; }
}

async function resolveMemoryName(root: string, name?: string): Promise<string> {
  if (name) { assertMemoryName(name); return name; }
  const active = await activeMemoryName(root);
  if (!active) throw new Error("No active project memory.");
  return active;
}

async function readManifest(root: string, name: string): Promise<ProjectMemoryManifest> {
  const directory = memoryPath(root, name);
  await assertSafeDirectory(directory, root);
  const manifest = await readJson<ProjectMemoryManifest>(path.join(directory, "memory.json"));
  const expectedProject = path.dirname(path.dirname(root));
  if (![1, 2].includes(manifest.schemaVersion) || manifest.name !== name || path.resolve(manifest.projectPath) !== expectedProject || !Array.isArray(manifest.revisions)) {
    throw new Error(`Memory '${name}' has unsupported or inconsistent metadata.`);
  }
  if (manifest.revisions.some((revision) => !REVISION_ID.test(revision.id))) {
    throw new Error(`Memory '${name}' contains an invalid revision id.`);
  }
  return manifest;
}

async function setActive(root: string, name: string): Promise<void> {
  await writeJsonAtomic(path.join(root, "active.json"), { schemaVersion: MEMORY_SCHEMA_VERSION, name, updatedAt: new Date().toISOString() });
}

function assertAttachId(id: string): void {
  if (!ATTACH_ID.test(id)) throw new Error(`Invalid attach id '${id}'.`);
}

async function runsRoot(directory: string, create: boolean): Promise<string> {
  const root = path.join(directory, "runs");
  if (create) await ensureDirectory(root, directory);
  else await assertSafeDirectory(root, directory);
  return root;
}

async function readMemoryRun(directory: string, attachId: string): Promise<HammaMemoryRun> {
  assertAttachId(attachId);
  const root = await runsRoot(directory, false);
  const runDirectory = path.join(root, attachId);
  await assertSafeDirectory(runDirectory, root);
  const run = await readJson<HammaMemoryRun>(path.join(runDirectory, "run.json"));
  if (run.schemaVersion !== 2 || run.id !== attachId || !Array.isArray(run.history)) {
    throw new Error(`Attach run '${attachId}' has invalid metadata.`);
  }
  return run;
}

async function writeMemoryRun(directory: string, run: HammaMemoryRun): Promise<void> {
  assertAttachId(run.id);
  const root = await runsRoot(directory, true);
  const runDirectory = path.join(root, run.id);
  try { await fs.mkdir(runDirectory); } catch (error: any) { if (error.code !== "EEXIST") throw error; }
  await assertSafeDirectory(runDirectory, root);
  await writeJsonAtomic(path.join(runDirectory, "run.json"), run);
}

async function listMemoryRuns(directory: string): Promise<HammaMemoryRun[]> {
  let root: string;
  try { root = await runsRoot(directory, false); } catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const runs: HammaMemoryRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ATTACH_ID.test(entry.name)) continue;
    runs.push(await readMemoryRun(directory, entry.name));
  }
  return runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function isOpenRun(run: HammaMemoryRun): boolean {
  return run.status === "claimed" || run.status === "running";
}

async function transitionMemoryRun(
  directory: string,
  attachId: string,
  status: HammaMemoryRun["status"],
  details: { sourceCli?: string; sourceSessionId?: string; revisionId?: string; reason?: string } = {}
): Promise<HammaMemoryRun> {
  const run = await readMemoryRun(directory, attachId);
  if (!isOpenRun(run)) throw new Error(`Attach run '${attachId}' is already ${run.status}.`);
  const now = new Date().toISOString();
  const updated: HammaMemoryRun = {
    ...run,
    status,
    updatedAt: now,
    targetSourceCli: details.sourceCli ?? run.targetSourceCli,
    targetSessionId: details.sourceSessionId ?? run.targetSessionId,
    finalRevision: details.revisionId ?? run.finalRevision,
    history: [...run.history, { status, at: now, ...details }],
  };
  await writeMemoryRun(directory, updated);
  return updated;
}

export async function bindMemoryRunSession(
  projectPath: string,
  requestedName: string | undefined,
  attachId: string,
  targetCli: string,
  sessionId: string
): Promise<HammaMemoryRun> {
  const project = await canonicalProject(projectPath);
  const root = await storeRoot(project, false);
  const name = await resolveMemoryName(root, requestedName);
  const directory = memoryPath(root, name);
  const lock = await acquireLock(directory);
  try {
    const run = await readMemoryRun(directory, attachId);
    if (!isOpenRun(run)) throw new Error(`Attach run '${attachId}' is already ${run.status}.`);
    if (run.projectPath !== project || run.memory !== name) {
      throw new Error(`Attach run '${attachId}' belongs to a different project memory.`);
    }
    if (run.targetCli !== targetCli) {
      throw new Error(`Attach run '${attachId}' targets ${run.targetCli}, not ${targetCli}.`);
    }
    if (run.targetSessionId && run.targetSessionId !== sessionId) {
      throw new Error(
        `Attach run '${attachId}' is already bound to session ${run.targetSessionId}; refusing session ${sessionId}.`
      );
    }
    if (run.status === "running" && run.targetSessionId === sessionId) return run;
    return transitionMemoryRun(directory, attachId, "running", {
      sourceCli: targetCli,
      sourceSessionId: sessionId,
    });
  } finally {
    await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function startMemory(projectPath: string, name: string, goal?: string, useGitignore = true): Promise<ProjectMemoryManifest> {
  assertMemoryName(name);
  const project = await canonicalProject(projectPath);
  const root = await storeRoot(project, true);
  const directory = memoryPath(root, name);
  try { await fs.mkdir(directory); } catch (error: any) { if (error.code === "EEXIST") throw new Error(`Project memory '${name}' already exists.`); throw error; }
  try {
    await assertSafeDirectory(directory, root);
    await ensureDirectory(path.join(directory, "revisions"), directory);
    await ensureDirectory(path.join(directory, "runs"), directory);
    const createdAt = new Date().toISOString();
    const manifest: ProjectMemoryManifest = { schemaVersion: 2, name, projectPath: project, createdAt, updatedAt: createdAt, goal: goal?.trim() || undefined, revisionCount: 0, revisions: [] };
    await writeJsonAtomic(path.join(directory, "memory.json"), manifest);
    await setActive(root, name);
    if (useGitignore) await ensureGitignore(project);
    return manifest;
  } catch (error) { await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined); throw error; }
}

async function ensureExplicitMemory(project: string, requestedName: string | undefined, useGitignore: boolean): Promise<{ root: string; name: string }> {
  let root: string;
  try { root = await storeRoot(project, false); } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    const created = await startMemory(project, requestedName ?? DEFAULT_MEMORY_NAME, undefined, useGitignore);
    return { root: await storeRoot(project, false), name: created.name };
  }
  if (requestedName) {
    assertMemoryName(requestedName);
    try { await readManifest(root, requestedName); return { root, name: requestedName }; } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      const created = await startMemory(project, requestedName, undefined, useGitignore);
      return { root: await storeRoot(project, false), name: created.name };
    }
  }
  const active = await activeMemoryName(root);
  if (active) return { root, name: active };
  const defaultDirectory = path.join(root, DEFAULT_MEMORY_NAME);
  try {
    await fs.lstat(defaultDirectory);
    await setActive(root, DEFAULT_MEMORY_NAME);
    return { root, name: DEFAULT_MEMORY_NAME };
  } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  const created = await startMemory(project, DEFAULT_MEMORY_NAME, undefined, useGitignore);
  return { root: await storeRoot(project, false), name: created.name };
}

function compatibilityMemoryState(state: HammaTaskState, revision: MemoryRevisionSummary): HammaMemoryState {
  const memory = emptyMemoryState(revision.createdAt);
  const session: HammaSession = {
    meta: { sourceCli: state.project.sourceCli as HammaSession["meta"]["sourceCli"], sourceSessionId: state.project.sourceSessionId ?? "legacy", startedAt: state.project.startedAt },
    messages: [], shellCommands: [], parserWarnings: [], security: { redacted: true, redactionCount: 0, warnings: [] },
  };
  const id = taskEpochId(state, session);
  memory.projectSummary = state.goal;
  memory.activeEpochId = id;
  memory.taskEpochs.push({
    id, sourceCli: state.project.sourceCli, sourceSessionId: state.project.sourceSessionId,
    boundary: taskEpochBoundary(state, session), createdAt: revision.createdAt, updatedAt: revision.createdAt,
    sessionSummary: state.current.latestAssistantStatus ?? state.nextAction ?? state.goal ?? "Legacy task state",
    outcome: state.outcome, goal: state.goal, nextAction: state.nextAction, taskState: state, revisionIds: [revision.id],
  });
  return memory;
}

async function latestState(root: string, manifest: ProjectMemoryManifest): Promise<LatestMemoryRevision | undefined> {
  if (!manifest.latestRevision) return undefined;
  if (!REVISION_ID.test(manifest.latestRevision)) throw new Error(`Memory '${manifest.name}' has an invalid latest revision id.`);
  const revision = manifest.revisions.find((item) => item.id === manifest.latestRevision);
  if (!revision) throw new Error(`Memory '${manifest.name}' latest revision metadata is missing.`);
  const directory = path.join(root, manifest.name, "revisions", revision.id);
  await assertSafeDirectory(directory, path.join(root, manifest.name));
  const state = await readJson<HammaTaskState>(path.join(directory, "state.json"));
  try {
    const memoryState = await readJson<HammaMemoryState>(path.join(directory, "memory-state.json"));
    if (memoryState.schemaVersion !== 2) throw new Error("unsupported memory state");
    return { revision, path: directory, state, memoryState, compatibilityView: false };
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    return { revision, path: directory, state, memoryState: compatibilityMemoryState(state, revision), compatibilityView: true };
  }
}

export async function listMemories(projectPath: string): Promise<MemoryListEntry[]> {
  let root: string;
  try { root = await storeRoot(projectPath, false); } catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
  const active = await activeMemoryName(root);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const memories: MemoryListEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !MEMORY_NAME.test(entry.name)) continue;
    const manifest = await readManifest(root, entry.name);
    const latest = await latestState(root, manifest);
    const openRun = (await listMemoryRuns(memoryPath(root, entry.name))).find(isOpenRun);
    memories.push({ name: manifest.name, active: manifest.name === active, schemaVersion: manifest.schemaVersion, revisionCount: manifest.revisionCount, updatedAt: manifest.updatedAt, latestRevision: manifest.latestRevision, sourceCli: latest?.revision.sourceCli, nextAction: latest?.state.nextAction, outcome: latest?.state.outcome, openAttachId: openRun?.id, openAttachTarget: openRun?.targetCli });
  }
  return memories.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name));
}

export async function inspectMemory(projectPath: string, requestedName?: string): Promise<MemoryInspection> {
  const project = await canonicalProject(projectPath);
  const root = await storeRoot(project, false);
  const name = await resolveMemoryName(root, requestedName);
  const manifest = await readManifest(root, name);
  const active = (await activeMemoryName(root)) === name;
  const latest = await latestState(root, manifest);
  const openRuns = (await listMemoryRuns(memoryPath(root, name))).filter(isOpenRun);
  if (!latest) return { schemaVersion: 2, active, compatibilityView: manifest.schemaVersion === 1, manifest, openRuns };
  const current = captureGitRepositorySnapshot(project, latest.state.filesMentioned);
  const drift = compareRepositorySnapshots(latest.state.repoState.snapshot, current);
  const bootstrap = path.join(latest.path, latest.compatibilityView ? "handoff.md" : "bootstrap.md");
  return { schemaVersion: 2, active, compatibilityView: latest.compatibilityView || manifest.schemaVersion === 1, manifest, openRuns, latest: { revision: latest.revision, revisionPath: latest.path, state: latest.state, memoryState: latest.memoryState, bootstrapPath: bootstrap, drift, readiness: assessHandoffReadiness(latest.state, drift) } };
}

function sourceContentFingerprint(session: HammaSession): string {
  return createHash("sha256").update(JSON.stringify({ messages: session.messages, shellCommands: session.shellCommands })).digest("hex");
}

function sourceFingerprint(session: HammaSession, update: HammaMemoryUpdate): string {
  return createHash("sha256").update(`${sourceContentFingerprint(session)}\0${JSON.stringify(update)}`).digest("hex");
}

const HAMMA_TRANSPORT_MESSAGE = /\[HAMMA_(?:ATTACH_ID:[0-9a-f-]+|CONTEXT_LOAD)\]|^Attach Hamma repository memory '/i;

function withoutHammaTransportMessages(session: HammaSession): HammaSession {
  return {
    ...session,
    messages: session.messages.filter((message) =>
      !(message.role === "user" && HAMMA_TRANSPORT_MESSAGE.test(message.content.trim()))
    ),
  };
}

function evidenceKey(item: HammaEvidenceItem): string { return [item.source, item.kind, item.status, item.summary, item.command ?? "", item.exitCode ?? ""].join("\0"); }
function uniqueEvidence(items: HammaEvidenceItem[]): HammaEvidenceItem[] { const seen = new Set<string>(); return items.filter((item) => { const key = evidenceKey(item); if (seen.has(key)) return false; seen.add(key); return true; }).slice(-100); }
function taskKey(task: HammaTaskLedgerItem): string { const text = (task.title ?? task.summary).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160); return task.id ? `id:${task.id}:${text}` : `text:${text}`; }
function isGenericTaskStatus(task: HammaTaskLedgerItem): boolean { if (!task.id) return false; const escaped = task.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return new RegExp(`^Task\\s*#?${escaped}\\s+(?:is\\s+)?(?:completed|complete|done|fixed|implemented|remains?|remaining|pending)[.!]?$`, "i").test(task.summary.trim()); }
function compatibleTaskIdTransition(existing: HammaTaskLedgerItem, incoming: HammaTaskLedgerItem): boolean { return Boolean(existing.id && existing.id === incoming.id && (isGenericTaskStatus(existing) || isGenericTaskStatus(incoming))); }
function uniqueStrings(values: string[], limit: number): string[] { return [...new Set(values.filter(Boolean))].slice(-limit); }

/** Compatibility merge for updates within one task epoch. Cross-epoch state never uses this function. */
export function mergeMemoryState(previous: HammaTaskState | undefined, current: HammaTaskState): { state: HammaTaskState; warnings: string[] } {
  if (!previous) return { state: current, warnings: [] };
  const warnings: string[] = [];
  const tasks = new Map(previous.tasks.map((task) => [taskKey(task), task]));
  for (const incoming of current.tasks) {
    let key = taskKey(incoming); let existing = tasks.get(key);
    if (!existing && incoming.id) { const compatible = [...tasks.entries()].find(([, task]) => compatibleTaskIdTransition(task, incoming)); if (compatible) [key, existing] = compatible; }
    if (!existing) { if (incoming.id && [...tasks.values()].some((task) => task.id === incoming.id)) warnings.push(`Task id #${incoming.id} was reused with different text; both entries were retained for review.`); tasks.set(key, incoming); continue; }
    let status = incoming.status;
    if (existing.status === "completed" && incoming.status !== "completed") { status = "completed"; warnings.push(`Preserved completed status for '${incoming.title ?? incoming.summary}' because the newer session did not provide an explicit compatible completion transition.`); }
    tasks.set(key, { ...incoming, title: incoming.title ?? existing.title, status, evidence: uniqueStrings([...existing.evidence, ...incoming.evidence], 30), risks: uniqueStrings([...existing.risks, ...incoming.risks], 20), filesMentioned: normalizeFilesMentioned([...existing.filesMentioned, ...incoming.filesMentioned]) });
  }
  const mergedTasks = [...tasks.values()];
  const outcome = mergedTasks.some((task) => task.status === "blocked") ? "blocked" : mergedTasks.some((task) => ["remaining", "in_progress", "unknown"].includes(task.status)) ? "actionable" : current.outcome;
  return { state: { ...current, outcome, goal: previous.goal ?? current.goal, nextAction: outcome === "completed" ? undefined : current.nextAction ?? previous.nextAction, tasks: mergedTasks, verification: uniqueStrings([...previous.verification, ...current.verification], 40), evidence: uniqueEvidence([...previous.evidence, ...current.evidence]), risks: uniqueStrings([...previous.risks, ...current.risks], 40), filesMentioned: normalizeFilesMentioned([...previous.filesMentioned, ...current.filesMentioned]) }, warnings };
}

function renderMemoryHandoff(state: HammaTaskState, memoryName: string): string {
  return renderHandoffWithSizeGuard(state)
    .replace("# Hamma Handoff", `# Hamma Project Memory: ${memoryName}`)
    .replace("See timeline.md and state.json for the full picture.", "See bootstrap.md and memory-state.json for durable repository context.")
    .replace(/Run `hamma show <task-id> --check-drift` when available/, `Run \`hamma memory show ${memoryName}\` when available`)
    .replace(/## References\n[\s\S]*$/, ["## References", "- Default context: bootstrap.md", "- Durable structured knowledge: memory-state.json", "- Compatible task state: state.json", "- Sanitized message delta: conversation.jsonl", "- Archive-only bounded tool diagnostics: tool_history.jsonl", ""].join("\n"));
}

async function acquireLock(directory: string): Promise<string> {
  const lock = path.join(directory, ".sync-lock");
  for (let attempt = 0; attempt <= MEMORY_LOCK_RETRIES; attempt++) {
    try {
      await fs.mkdir(lock);
      await fs.writeFile(
        path.join(lock, "owner.json"),
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        { encoding: "utf8", flag: "wx" }
      );
      return lock;
    } catch (error: any) {
      if (error.code !== "EEXIST") {
        await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    }

    // Lock already exists — check if stale and recoverable.
    let stats;
    try {
      stats = await fs.lstat(lock);
    } catch (error: any) {
      // Lock disappeared between our failed mkdir and lstat — retry immediately.
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Memory synchronization lock is not a safe directory: ${lock}`);
    }
    let ownerPid: number | undefined;
    try {
      const owner = JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8")) as {
        pid?: unknown;
      };
      if (Number.isInteger(owner.pid) && Number(owner.pid) > 0) ownerPid = Number(owner.pid);
    } catch (error: any) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    let ownerAlive = false;
    if (ownerPid) {
      try {
        process.kill(ownerPid, 0);
        ownerAlive = true;
      } catch (error: any) {
        ownerAlive = error.code === "EPERM";
      }
    }
    if (Date.now() - stats.mtimeMs <= MEMORY_LOCK_STALE_MS || ownerAlive) {
      // Lock is fresh or owner is alive — wait and retry if attempts remain.
      if (attempt < MEMORY_LOCK_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, MEMORY_LOCK_RETRY_MS * (attempt + 1)));
        continue;
      }
      throw new Error(
        "This memory is already being synchronized by another process. " +
        `Retried ${MEMORY_LOCK_RETRIES} times over ${MEMORY_LOCK_RETRIES * MEMORY_LOCK_RETRY_MS / 1000}s.`
      );
    }
    // Stale lock recovery: atomically attempt to replace via rename race-free pattern.
    // Remove and immediately re-mkdir. If another process races us, mkdir will EEXIST
    // and the loop retries (TOCTOU-safe via the retry loop).
    await fs.rm(lock, { recursive: true, force: true });
    // Don't write owner here — let the next loop iteration do the mkdir+writeFile atomically.
  }
  // Should not be reachable, but safeguard.
  throw new Error("This memory is already being synchronized by another process.");
}

async function cleanupInterruptedRevisionWrites(
  directory: string,
  manifest: ProjectMemoryManifest
): Promise<void> {
  const revisionsRoot = path.join(directory, "revisions");
  let entries;
  try {
    entries = await fs.readdir(revisionsRoot, { withFileTypes: true });
  } catch (error: any) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const referenced = new Set(manifest.revisions.map((revision) => revision.id));
  await Promise.all(entries
    .filter((entry) =>
      entry.isDirectory() &&
      (entry.name.startsWith(".tmp-") || (REVISION_ID.test(entry.name) && !referenced.has(entry.name)))
    )
    .map((entry) => fs.rm(path.join(revisionsRoot, entry.name), {
      recursive: true,
      force: true,
    })));
  const memoryEntries = await fs.readdir(directory, { withFileTypes: true });
  await Promise.all(memoryEntries
    .filter((entry) =>
      entry.isFile() && /^memory\.json\.tmp-\d+-\d+$/.test(entry.name)
    )
    .map((entry) => fs.rm(path.join(directory, entry.name), { force: true })));
}

function renderConversation(messages: ArchivedMemoryMessage[]): string {
  return messages.map((message) => JSON.stringify({ ...message, content: redactText(message.content).text })).join("\n") + (messages.length ? "\n" : "");
}

function redactMemoryUpdate(update: HammaMemoryUpdate): { update: HammaMemoryUpdate; count: number } {
  let count = 0;
  const clean = (value: string): string => {
    const redacted = redactText(value);
    count += redacted.count;
    return redacted.text;
  };
  return {
    update: {
      sessionSummary: clean(update.sessionSummary),
      projectSummary: update.projectSummary ? clean(update.projectSummary) : undefined,
      outcome: update.outcome,
      nextAction: typeof update.nextAction === "string" ? clean(update.nextAction) : update.nextAction,
      decisions: update.decisions?.map((decision) => typeof decision === "string"
        ? clean(decision)
        : {
          decision: clean(decision.decision),
          rationale: decision.rationale ? clean(decision.rationale) : undefined,
          files: decision.files?.map(clean),
        }),
      constraints: update.constraints?.map(clean),
      preferences: update.preferences?.map(clean),
      discoveries: update.discoveries?.map(clean),
      failedApproaches: update.failedApproaches?.map(clean),
      openQuestions: update.openQuestions?.map(clean),
    },
    count,
  };
}

export async function syncMemory(projectPath: string, requestedName?: string, options: MemorySyncOptions = {}): Promise<MemorySyncResult> {
  const project = await canonicalProject(projectPath);
  if (!options.source) {
    throw new Error("Memory sync requires an exact `--source <agent>:<session>`; repository-wide automatic session selection is disabled to prevent cross-task capture.");
  }
  const suppliedUpdate = options.update ? validateMemoryUpdate(options.update) : options.updateFile ? await readUpdateFile(options.updateFile) : undefined;
  const sanitizedUpdate = suppliedUpdate ? redactMemoryUpdate(suppliedUpdate) : undefined;
  const explicitUpdate = sanitizedUpdate?.update;
  let root: string; let name: string;
  if (options.lifecycleHook) {
    try { root = await storeRoot(project, false); name = await resolveMemoryName(root, requestedName); } catch (error: any) { if (error.code === "ENOENT" || String(error.message).includes("No active")) throw new Error("No active project memory; lifecycle sync skipped."); throw error; }
  } else ({ root, name } = await ensureExplicitMemory(project, requestedName, options.useGitignore !== false));
  const directory = memoryPath(root, name);
  await readManifest(root, name);
  const openRun = (await listMemoryRuns(directory)).find(isOpenRun);
  if (openRun && !options.attachId) {
    if (options.lifecycleHook) {
      throw new Error("An open attach run requires explicit checkpoint or finish writeback; lifecycle sync skipped.");
    }
    throw new Error(`Memory '${name}' has open attach run ${openRun.id}; use memory checkpoint or finish with that attach id instead of standalone sync.`);
  }
  const attachedRun = options.attachId ? await readMemoryRun(directory, options.attachId) : undefined;
  if (attachedRun && (!isOpenRun(attachedRun) || attachedRun.memory !== name || attachedRun.projectPath !== project)) {
    throw new Error(`Attach run '${attachedRun.id}' is not an open run for memory '${name}'.`);
  }
  const lock = await acquireLock(directory);
  try {
    await options.faultInjector?.("after-lock-acquired");
    const manifest = await readManifest(root, name);
    await cleanupInterruptedRevisionWrites(directory, manifest);
    const previous = await latestState(root, manifest);
    let session = await loadSession(options.source, { projectPath: project });
    if (attachedRun && session.meta.sourceCli !== attachedRun.targetCli) {
      throw new Error(`Attach run '${attachedRun.id}' targets ${attachedRun.targetCli}, but the writeback source is ${session.meta.sourceCli}.`);
    }
    const candidate = scoreSession(session, { sourceCli: session.meta.sourceCli, sessionId: session.meta.sourceSessionId, path: session.meta.sourcePath ?? options.source, projectPathHint: session.meta.projectPath, lastUpdatedAt: session.meta.lastUpdatedAt ?? session.meta.startedAt ?? new Date(0).toISOString() });
    const explanation = [`Used explicitly selected ${session.meta.sourceCli} session ${session.meta.sourceSessionId}.`, `Quality score ${candidate.score} (${candidate.confidence} confidence); explicit selection was preserved.`];
    const selectionMode = "explicit" as const;
    session.meta.projectPath = project;
    const extractionSession = withoutHammaTransportMessages(session);
    const repoState = computeRepoState(project); repoState.snapshot = captureGitRepositorySnapshot(project);
    let extracted = extractTaskState(extractionSession, { targetCli: "memory", repoState });
    if (!previous && manifest.goal) extracted.goal = manifest.goal;
    const epochId = attachedRun?.epochId ?? taskEpochId(extracted, extractionSession);
    const priorEpoch = previous?.memoryState.taskEpochs.find((epoch) => epoch.id === epochId);
    const merged = priorEpoch ? mergeMemoryState(priorEpoch.taskState, extracted) : { state: extracted, warnings: [] };
    extracted = merged.state;
    repoState.snapshot = captureGitRepositorySnapshot(project, extracted.filesMentioned); extracted.repoState = repoState; extracted.project.targetCli = "memory";
    extracted.references = { fullSession: "conversation.jsonl (sanitized deltas)", timeline: "memory-state.json (task epochs)", commands: "tool_history.jsonl (archive only)", redactionReport: "(redaction applied during normalization and archive write)" };
    const requestedOutcome = options.forcedOutcome ?? explicitUpdate?.outcome;
    const requestedNextAction = options.forcedNextAction !== undefined
      ? options.forcedNextAction
      : explicitUpdate?.nextAction;
    if (attachedRun && priorEpoch) {
      extracted.goal = priorEpoch.goal ?? extracted.goal;
      if (requestedOutcome) extracted.outcome = requestedOutcome;
      else extracted.outcome = priorEpoch.outcome;
      if (requestedNextAction !== undefined) extracted.nextAction = requestedNextAction ?? undefined;
      else extracted.nextAction = priorEpoch.nextAction;
      if (extracted.outcome === "completed") {
        extracted.nextAction = undefined;
        extracted.tasks = extracted.tasks.map((task) =>
          ["remaining", "in_progress", "unknown", "blocked"].includes(task.status)
            ? { ...task, status: "completed" as const }
            : task
        );
      }
    } else {
      if (requestedOutcome) extracted.outcome = requestedOutcome;
      if (requestedNextAction !== undefined) extracted.nextAction = requestedNextAction ?? undefined;
      if (extracted.outcome === "completed") {
        extracted.nextAction = undefined;
        extracted.tasks = extracted.tasks.map((task) =>
          ["remaining", "in_progress", "unknown", "blocked"].includes(task.status)
            ? { ...task, status: "completed" as const }
            : task
        );
      }
    }
    extracted.readiness = assessHandoffReadiness(extracted, compareRepositorySnapshots(repoState.snapshot, repoState.snapshot));
    const update = explicitUpdate ?? {
      ...deriveMemoryUpdate(extracted),
      outcome: requestedOutcome,
      nextAction: requestedNextAction,
    };
    const contentFingerprint = sourceContentFingerprint(session);
    const fingerprint = sourceFingerprint(session, update);
    if (previous && (previous.revision.sourceFingerprint === fingerprint ||
      (!suppliedUpdate && options.forcedOutcome === undefined &&
        options.forcedNextAction === undefined &&
        previous.revision.sourceContentFingerprint === contentFingerprint))) {
      await setActive(root, name);
      return { schemaVersion: 2, updated: false, memory: name, projectPath: project, selection: { mode: selectionMode, sourceCli: session.meta.sourceCli, sourceSessionId: session.meta.sourceSessionId, explanation }, warnings: [], reason: "The selected session and structured update match the latest memory revision." };
    }
    const currentBefore = captureGitRepositorySnapshot(project, previous?.state.filesMentioned ?? []);
    const parentDrift = previous ? compareRepositorySnapshots(previous.state.repoState.snapshot, currentBefore) : undefined;
    const revisionNumber = manifest.revisionCount + 1; const timestamp = new Date().toISOString();
    const revisionId = `${String(revisionNumber).padStart(6, "0")}-${timestamp.replace(/[:.]/g, "-")}-${session.meta.sourceCli}`;
    const memoryState: HammaMemoryState = previous ? structuredClone(previous.memoryState) : emptyMemoryState(timestamp);
    const provenance: MemoryProvenance = { sourceCli: session.meta.sourceCli, sourceSessionId: session.meta.sourceSessionId, revisionId, capturedAt: timestamp, source: explicitUpdate ? "structured_update" : "transcript" };
    memoryState.projectSummary = update.projectSummary ?? memoryState.projectSummary ?? (!previous ? extracted.goal : undefined);
    memoryState.knowledge = mergeMemoryKnowledge(memoryState.knowledge, update, provenance, extracted.filesMentioned);
    const epoch: HammaTaskEpoch = { id: epochId, sourceCli: attachedRun?.targetCli ?? session.meta.sourceCli, sourceSessionId: session.meta.sourceSessionId, boundary: priorEpoch?.boundary ?? taskEpochBoundary(extracted, extractionSession), createdAt: priorEpoch?.createdAt ?? timestamp, updatedAt: timestamp, sessionSummary: update.sessionSummary, outcome: extracted.outcome, goal: extracted.goal, nextAction: extracted.nextAction, taskState: extracted, revisionIds: [...(priorEpoch?.revisionIds ?? []), revisionId] };
    const epochIndex = memoryState.taskEpochs.findIndex((item) => item.id === epochId);
    if (epochIndex >= 0) memoryState.taskEpochs[epochIndex] = epoch; else memoryState.taskEpochs.push(epoch);
    memoryState.activeEpochId = epochId; memoryState.updatedAt = timestamp;
    const cursorKey = sourceCursorKey(session); const delta = conversationDelta(extractionSession, memoryState.sourceCursors[cursorKey]); memoryState.sourceCursors[cursorKey] = delta.cursor;
    const bootstrap = renderMemoryBootstrap(name, memoryState, extracted, INITIAL_CONTEXT_TARGET_BYTES);
    const initialContextBytes = Buffer.byteLength(bootstrap, "utf8"); const sourceContextBytes = measureNormalizedSourceBytes(session);
    const warnings = [...candidate.reasons, ...merged.warnings];
    if (sanitizedUpdate?.count) warnings.push(`Redacted ${sanitizedUpdate.count} potential secret${sanitizedUpdate.count === 1 ? "" : "s"} from the structured memory update.`);
    if (delta.rewritten) warnings.push(`Source history for ${cursorKey} was rewritten; stored a safe full normalized conversation snapshot.`);
    if (initialContextBytes > sourceContextBytes) warnings.push(`Initial bootstrap (${initialContextBytes} bytes) is larger than the normalized source content (${sourceContextBytes} bytes).`);
    if (parentDrift?.detected) warnings.push(`Repository differences from the parent revision were recorded: ${parentDrift.categories.join(", ")}.`);
    if (previous?.compatibilityView || manifest.schemaVersion === 1) warnings.push("Migrated the latest v1 state into a v2 compatibility epoch; existing revisions were retained unchanged.");
    const revision: MemoryRevisionSummary = { id: revisionId, parentRevision: manifest.latestRevision, createdAt: timestamp, sourceCli: session.meta.sourceCli, sourceSessionId: session.meta.sourceSessionId, sourceLastUpdatedAt: session.meta.lastUpdatedAt, sourceContentFingerprint: contentFingerprint, sourceFingerprint: fingerprint, driftFromParent: parentDrift?.categories ?? ["none"], warnings, kind: "sync" };
    const revisionsRoot = path.join(directory, "revisions"); const finalRevisionPath = path.join(revisionsRoot, revisionId); const temporaryRevisionPath = path.join(revisionsRoot, `.tmp-${revisionId}`);
    await fs.mkdir(temporaryRevisionPath);
    let revisionPublished = false;
    try {
      await Promise.all([
        writeJsonAtomic(path.join(temporaryRevisionPath, "state.json"), extracted),
        writeJsonAtomic(path.join(temporaryRevisionPath, "memory-state.json"), memoryState),
        writeJsonAtomic(path.join(temporaryRevisionPath, "revision.json"), revision),
        fs.writeFile(path.join(temporaryRevisionPath, "bootstrap.md"), bootstrap, "utf8"),
        fs.writeFile(path.join(temporaryRevisionPath, "handoff.md"), renderMemoryHandoff(extracted, name), "utf8"),
        fs.writeFile(path.join(temporaryRevisionPath, "conversation.jsonl"), renderConversation(delta.messages), "utf8"),
        fs.writeFile(path.join(temporaryRevisionPath, "tool_history.jsonl"), renderToolHistoryJsonl(session), "utf8"),
      ]);
      await options.faultInjector?.("after-revision-files-written");
      await fs.rename(temporaryRevisionPath, finalRevisionPath);
      revisionPublished = true;
      await options.faultInjector?.("after-revision-published");
      const updatedManifest: ProjectMemoryManifest = { ...manifest, schemaVersion: 2, goal: manifest.goal ?? extracted.goal, updatedAt: timestamp, latestRevision: revisionId, revisionCount: revisionNumber, revisions: [...manifest.revisions, revision] };
      await writeJsonAtomic(path.join(directory, "memory.json"), updatedManifest);
    } catch (error) {
      await fs.rm(temporaryRevisionPath, { recursive: true, force: true }).catch(() => undefined);
      if (revisionPublished) {
        await fs.rm(finalRevisionPath, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }
    await setActive(root, name); if (options.useGitignore !== false) await ensureGitignore(project);
    return { schemaVersion: 2, updated: true, memory: name, projectPath: project, revision, revisionPath: finalRevisionPath, bootstrapPath: path.join(finalRevisionPath, "bootstrap.md"), memoryStatePath: path.join(finalRevisionPath, "memory-state.json"), statePath: path.join(finalRevisionPath, "state.json"), handoffPath: path.join(finalRevisionPath, "handoff.md"), conversationPath: path.join(finalRevisionPath, "conversation.jsonl"), toolHistoryPath: path.join(finalRevisionPath, "tool_history.jsonl"), contextBudget: { initialArtifacts: ["bootstrap.md"], bytes: initialContextBytes, maxBytes: INITIAL_CONTEXT_MAX_BYTES, withinBudget: initialContextBytes <= INITIAL_CONTEXT_MAX_BYTES, sourceBytes: sourceContextBytes, continuationLargerThanSource: initialContextBytes > sourceContextBytes }, selection: { mode: selectionMode, sourceCli: session.meta.sourceCli, sourceSessionId: session.meta.sourceSessionId, explanation }, warnings };
  } finally { await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined); }
}

function correctionText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must be a non-empty string.`);
  if (Buffer.byteLength(trimmed, "utf8") > 16_384) {
    throw new Error(`${label} exceeds the 16384-byte limit.`);
  }
  return redactText(trimmed).text;
}

async function correctMemory(
  projectPath: string,
  requestedName: string | undefined,
  action: "repair" | "close",
  options: MemoryRepairOptions
): Promise<MemoryCorrectionResult> {
  const project = await canonicalProject(projectPath);
  const root = await storeRoot(project, false);
  const name = await resolveMemoryName(root, requestedName);
  const directory = memoryPath(root, name);
  const reason = correctionText(options.reason, "Correction reason");
  const goal = options.goal === undefined
    ? undefined
    : correctionText(options.goal, "Goal");
  const nextAction = typeof options.nextAction === "string"
    ? correctionText(options.nextAction, "Next action")
    : options.nextAction;
  if (options.outcome === "completed" && nextAction) {
    throw new Error("A completed memory correction cannot retain a next action.");
  }
  if ((await listMemoryRuns(directory)).some(isOpenRun)) {
    throw new Error(`Memory '${name}' has an open attach run; finish or abandon it before correcting memory state.`);
  }

  const lock = await acquireLock(directory);
  try {
    const manifest = await readManifest(root, name);
    const previous = await latestState(root, manifest);
    if (!previous) throw new Error(`Memory '${name}' has no revision to correct.`);

    const corrected = structuredClone(previous.state);
    const fields: Array<"goal" | "outcome" | "nextAction"> = [];
    if (goal !== undefined && goal !== corrected.goal) {
      corrected.goal = goal;
      fields.push("goal");
    }
    if (options.outcome !== undefined && options.outcome !== corrected.outcome) {
      corrected.outcome = options.outcome;
      fields.push("outcome");
    }
    if (nextAction !== undefined) {
      const normalized = nextAction ?? undefined;
      if (normalized !== corrected.nextAction) {
        corrected.nextAction = normalized;
        fields.push("nextAction");
      }
    }
    if (corrected.outcome === "completed") {
      if (corrected.nextAction !== undefined && !fields.includes("nextAction")) {
        fields.push("nextAction");
      }
      corrected.nextAction = undefined;
      corrected.tasks = corrected.tasks.map((task) =>
        task.status === "completed" ? task : { ...task, status: "completed" as const }
      );
    }
    if (corrected.outcome === "actionable" && !corrected.nextAction) {
      throw new Error("An actionable memory correction requires --next-action.");
    }
    if (fields.length === 0) {
      throw new Error(`The requested ${action} operation does not change the latest memory state.`);
    }

    corrected.current.nextRecommendedTask = corrected.nextAction;
    const currentSnapshot = captureGitRepositorySnapshot(project, corrected.filesMentioned);
    const parentDrift = compareRepositorySnapshots(previous.state.repoState.snapshot, currentSnapshot);
    corrected.repoState = computeRepoState(project);
    corrected.repoState.snapshot = currentSnapshot;
    corrected.readiness = assessHandoffReadiness(
      corrected,
      compareRepositorySnapshots(currentSnapshot, currentSnapshot)
    );

    const revisionNumber = manifest.revisionCount + 1;
    const timestamp = new Date().toISOString();
    const revisionId = `${String(revisionNumber).padStart(6, "0")}-${timestamp.replace(/[:.]/g, "-")}-user`;
    const memoryState = structuredClone(previous.memoryState);
    const epochIndex = memoryState.taskEpochs.findIndex((epoch) =>
      epoch.id === memoryState.activeEpochId
    );
    const resolvedEpochIndex = epochIndex >= 0
      ? epochIndex
      : memoryState.taskEpochs.length - 1;
    if (resolvedEpochIndex < 0) {
      throw new Error(`Memory '${name}' has no task epoch to correct.`);
    }
    const previousEpoch = memoryState.taskEpochs[resolvedEpochIndex];
    memoryState.taskEpochs[resolvedEpochIndex] = {
      ...previousEpoch,
      updatedAt: timestamp,
      sessionSummary: `User ${action === "close" ? "closed" : "corrected"} memory state: ${reason}`,
      outcome: corrected.outcome,
      goal: corrected.goal,
      nextAction: corrected.nextAction,
      taskState: corrected,
      revisionIds: [...previousEpoch.revisionIds, revisionId],
    };
    memoryState.activeEpochId = previousEpoch.id;
    if (goal !== undefined) memoryState.projectSummary = goal;
    memoryState.updatedAt = timestamp;

    const bootstrap = renderMemoryBootstrap(name, memoryState, corrected, INITIAL_CONTEXT_TARGET_BYTES);
    const correction = { action, reason, fields };
    const revision: MemoryRevisionSummary = {
      id: revisionId,
      parentRevision: manifest.latestRevision,
      createdAt: timestamp,
      sourceCli: "user",
      sourceFingerprint: createHash("sha256")
        .update(JSON.stringify({ parent: manifest.latestRevision, correction }))
        .digest("hex"),
      driftFromParent: parentDrift.categories,
      warnings: parentDrift.detected
        ? [`Repository differences from the parent revision were recorded: ${parentDrift.categories.join(", ")}.`]
        : [],
      kind: "correction",
      correction,
    };
    const revisionsRoot = path.join(directory, "revisions");
    const finalRevisionPath = path.join(revisionsRoot, revisionId);
    const temporaryRevisionPath = path.join(revisionsRoot, `.tmp-${revisionId}`);
    await fs.mkdir(temporaryRevisionPath);
    try {
      await Promise.all([
        writeJsonAtomic(path.join(temporaryRevisionPath, "state.json"), corrected),
        writeJsonAtomic(path.join(temporaryRevisionPath, "memory-state.json"), memoryState),
        writeJsonAtomic(path.join(temporaryRevisionPath, "revision.json"), revision),
        fs.writeFile(path.join(temporaryRevisionPath, "bootstrap.md"), bootstrap, "utf8"),
        fs.writeFile(path.join(temporaryRevisionPath, "handoff.md"), renderMemoryHandoff(corrected, name), "utf8"),
        fs.writeFile(path.join(temporaryRevisionPath, "conversation.jsonl"), "", "utf8"),
        fs.writeFile(path.join(temporaryRevisionPath, "tool_history.jsonl"), "", "utf8"),
      ]);
      await fs.rename(temporaryRevisionPath, finalRevisionPath);
    } catch (error) {
      await fs.rm(temporaryRevisionPath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const updatedManifest: ProjectMemoryManifest = {
      ...manifest,
      schemaVersion: 2,
      goal: corrected.goal,
      updatedAt: timestamp,
      latestRevision: revisionId,
      revisionCount: revisionNumber,
      revisions: [...manifest.revisions, revision],
    };
    await writeJsonAtomic(path.join(directory, "memory.json"), updatedManifest);
    await setActive(root, name);
    return {
      schemaVersion: 2,
      memory: name,
      projectPath: project,
      action,
      revision,
      revisionPath: finalRevisionPath,
      bootstrapPath: path.join(finalRevisionPath, "bootstrap.md"),
      memoryStatePath: path.join(finalRevisionPath, "memory-state.json"),
      statePath: path.join(finalRevisionPath, "state.json"),
      handoffPath: path.join(finalRevisionPath, "handoff.md"),
      previous: {
        outcome: previous.state.outcome,
        goal: previous.state.goal,
        nextAction: previous.state.nextAction,
      },
      current: {
        outcome: corrected.outcome,
        goal: corrected.goal,
        nextAction: corrected.nextAction,
      },
    };
  } finally {
    await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function repairMemory(
  projectPath: string,
  requestedName: string | undefined,
  options: MemoryRepairOptions
): Promise<MemoryCorrectionResult> {
  if (
    options.goal === undefined &&
    options.outcome === undefined &&
    options.nextAction === undefined
  ) {
    throw new Error("Memory repair requires --goal, --outcome, --next-action, or --clear-next-action.");
  }
  return correctMemory(projectPath, requestedName, "repair", options);
}

export async function closeMemory(
  projectPath: string,
  requestedName: string | undefined,
  reason: string
): Promise<MemoryCorrectionResult> {
  return correctMemory(projectPath, requestedName, "close", {
    outcome: "completed",
    nextAction: null,
    reason,
  });
}

export function classifyMemoryExecutionMode(state: HammaTaskState, readiness: HandoffReadinessResult, drift: RepositoryDriftResult): { mode: MemoryExecutionMode; allowed: boolean } {
  if (state.outcome === "completed") return { mode: "ready_for_input", allowed: false };
  if (state.outcome === "blocked") return { mode: "blocked", allowed: false };
  if (state.outcome === "ambiguous") return { mode: "needs_instruction", allowed: false };
  const unsafe = readiness.level === "not_ready" || drift.categories.some((category) => ["repository_unavailable", "relevant_files_changed"].includes(category));
  return unsafe ? { mode: "review_required", allowed: false } : { mode: "continue_work", allowed: true };
}

export async function attachMemory(projectPath: string, requestedName: string | undefined, targetCli: string, options: MemoryAttachOptions = {}): Promise<MemoryAttachResult> {
  const project = await canonicalProject(projectPath); const warnings: string[] = []; let syncStatus: MemoryAttachResult["syncStatus"] = "skipped"; let syncRevision: string | undefined;
  if (options.source && !options.noSync) {
    const synced = await syncMemory(project, requestedName, { source: options.source, useGitignore: options.useGitignore });
    syncStatus = synced.updated ? "updated" : "unchanged"; syncRevision = synced.revision?.id; warnings.push(...synced.warnings);
  } else await ensureExplicitMemory(project, requestedName, options.useGitignore !== false);
  const inspection = await inspectMemory(project, requestedName);
  if (!inspection.latest) throw new Error(`Project memory '${inspection.manifest.name}' has no synchronized revision yet.`);
  const root = await storeRoot(project, false); await setActive(root, inspection.manifest.name);
  const latest = inspection.latest; const compatibility = inspection.compatibilityView;
  const bootstrapPath = latest.bootstrapPath; const bootstrapBytes = (await fs.stat(bootstrapPath)).size;
  const relativeBootstrap = path.relative(project, bootstrapPath);
  const mode = classifyMemoryExecutionMode(latest.state, latest.readiness, latest.drift);
  let run: HammaMemoryRun | undefined;
  if (mode.mode === "continue_work") {
    const directory = memoryPath(root, inspection.manifest.name);
    const lock = await acquireLock(directory);
    try {
      const existing = (await listMemoryRuns(directory)).find(isOpenRun);
      if (existing) {
        throw new Error(`Memory '${inspection.manifest.name}' already has open attach run ${existing.id} for ${existing.targetCli}. Finish it, checkpoint it, or abandon it before attaching again.`);
      }
      const now = new Date().toISOString();
      run = {
        schemaVersion: 2,
        id: randomUUID(),
        memory: inspection.manifest.name,
        projectPath: project,
        epochId: latest.memoryState.activeEpochId ?? latest.memoryState.taskEpochs.at(-1)?.id ?? taskEpochId(latest.state, {
          meta: { sourceCli: latest.revision.sourceCli as HammaSession["meta"]["sourceCli"], sourceSessionId: latest.revision.sourceSessionId ?? "unknown" },
          messages: [], shellCommands: [], parserWarnings: [], security: { redacted: true, redactionCount: 0, warnings: [] },
        }),
        baseRevision: latest.revision.id,
        targetCli,
        status: "claimed",
        createdAt: now,
        updatedAt: now,
        history: [{ status: "claimed", at: now }],
      };
      await writeMemoryRun(directory, run);
    } finally { await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined); }
  }
  const modeInstruction = mode.mode === "ready_for_input"
    ? "The previous epoch is complete. Load it as context only, do not repeat old work, and wait for the next user instruction."
    : mode.mode === "continue_work" ? `Continue only from the recorded next action: ${(latest.state.nextAction ?? "review the bootstrap").slice(0, 500)}. Run \`hamma save\` for a checkpoint and \`hamma done\` before leaving; Hamma will recover this task claim automatically.`
      : `Load context but do not execute automatically; execution mode is ${mode.mode}.`;
  const transportMarker = run ? `[HAMMA_ATTACH_ID:${run.id}]` : "[HAMMA_CONTEXT_LOAD]";
  const prompt = `${transportMarker} Attach Hamma repository memory '${inspection.manifest.name}'. Read only ${relativeBootstrap} as initial context. ${modeInstruction} Use hamma memory recall ${inspection.manifest.name} --query <text> only if deeper history is needed. Reconcile with live Git state; the repository wins on conflict.`;
  const suggestedCommand = ["codex", "claude", "grok"].includes(targetCli)
    ? `hamma ${targetCli} --memory ${JSON.stringify(inspection.manifest.name)} -- ${JSON.stringify(prompt)}`
    : `${targetCli} ${JSON.stringify(prompt)}`;
  const launchPromptBytes = Buffer.byteLength(prompt, "utf8"); const combinedBytes = bootstrapBytes + launchPromptBytes;
  const revisionPath = latest.revisionPath;
  return {
    schemaVersion: 2, memory: inspection.manifest.name, targetCli, projectPath: project, revision: latest.revision.id,
    memoryLoadAllowed: true, autoExecuteAllowed: mode.allowed, executionMode: mode.mode, previousOutcome: latest.state.outcome,
    bootstrapPath,
    supportingPaths: { memoryStatePath: path.join(revisionPath, compatibility ? "state.json" : "memory-state.json"), statePath: path.join(revisionPath, "state.json"), handoffPath: path.join(revisionPath, "handoff.md"), conversationPath: compatibility ? undefined : path.join(revisionPath, "conversation.jsonl") },
    statePath: path.join(revisionPath, "state.json"), handoffPath: path.join(revisionPath, "handoff.md"), toolHistoryPath: path.join(revisionPath, "tool_history.jsonl"),
    drift: latest.drift, readiness: latest.readiness, syncStatus, syncRevision, attachId: run?.id, run, warnings,
    contextBudget: { initialArtifacts: compatibility ? ["handoff.md"] : ["bootstrap.md"], bytes: bootstrapBytes, launchPromptBytes, combinedBytes, maxBytes: INITIAL_CONTEXT_MAX_BYTES, withinBudget: combinedBytes <= INITIAL_CONTEXT_MAX_BYTES },
    launch: { command: targetCli, args: [prompt] },
    suggestedCommand,
  };
}

export async function resumeMemory(projectPath: string, requestedName: string | undefined, targetCli: string, options: MemoryAttachOptions = {}): Promise<MemoryResumeResult> {
  const attached = await attachMemory(projectPath, requestedName, targetCli, options);
  return { ...attached, schemaVersion: 1, resumeAllowed: attached.autoExecuteAllowed };
}

async function transitionAfterWriteback(
  project: string,
  memory: string,
  attachId: string,
  status: HammaMemoryRun["status"],
  result: MemorySyncResult,
  source: string
): Promise<HammaMemoryRun> {
  const root = await storeRoot(project, false);
  const directory = memoryPath(root, memory);
  const manifest = await readManifest(root, memory);
  const [sourceCli, ...sessionParts] = source.split(":");
  const lock = await acquireLock(directory);
  try {
    return await transitionMemoryRun(directory, attachId, status, {
      sourceCli,
      sourceSessionId: result.selection.sourceSessionId ?? sessionParts.join(":"),
      revisionId: result.revision?.id ?? manifest.latestRevision,
    });
  } finally { await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined); }
}

export async function checkpointMemory(
  projectPath: string,
  requestedName: string | undefined,
  attachId: string,
  options: MemoryWritebackOptions
): Promise<MemoryWritebackResult> {
  const project = await canonicalProject(projectPath);
  const result = await syncMemory(project, requestedName, { ...options, attachId });
  const run = await transitionAfterWriteback(project, result.memory, attachId, "running", result, options.source);
  return { ...result, attachId, run };
}

export async function finishMemory(
  projectPath: string,
  requestedName: string | undefined,
  attachId: string,
  options: MemoryFinishOptions
): Promise<MemoryWritebackResult> {
  const supplied = options.update
    ? validateMemoryUpdate(options.update)
    : options.updateFile
      ? await readUpdateFile(options.updateFile)
      : undefined;
  const outcome = options.outcome ?? "completed";
  const update = supplied ? validateMemoryUpdate({
    ...supplied,
    outcome,
    nextAction: outcome === "completed" ? null : supplied.nextAction,
  }) : undefined;
  const project = await canonicalProject(projectPath);
  const result = await syncMemory(project, requestedName, {
    source: options.source,
    update,
    forcedOutcome: outcome,
    forcedNextAction: outcome === "completed" ? null : supplied?.nextAction ?? options.nextAction,
    useGitignore: options.useGitignore,
    attachId,
  });
  const run = await transitionAfterWriteback(project, result.memory, attachId, outcome, result, options.source);
  return { ...result, attachId, run };
}

export async function abandonMemory(
  projectPath: string,
  requestedName: string | undefined,
  attachId: string,
  reason: string
): Promise<HammaMemoryRun> {
  if (!reason.trim()) throw new Error("Abandon reason must not be empty.");
  const project = await canonicalProject(projectPath);
  const root = await storeRoot(project, false);
  const name = await resolveMemoryName(root, requestedName);
  const directory = memoryPath(root, name);
  const lock = await acquireLock(directory);
  try {
    return await transitionMemoryRun(directory, attachId, "abandoned", { reason: reason.trim().slice(0, 4000) });
  } finally { await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined); }
}

function queryTokens(query: string): string[] { return [...new Set(query.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? [])]; }
export function scoreMemoryRecall(query: string, content: string, files: string[] = [], recency = 0): number {
  const normalizedQuery = query.toLowerCase().trim(); const normalized = content.toLowerCase(); let score = recency;
  if (normalized.includes(normalizedQuery)) score += 100;
  for (const token of queryTokens(query)) { if (normalized.includes(token)) score += token.includes("/") || token.includes(".") ? 20 : 5; if (files.some((file) => file.toLowerCase().includes(token))) score += 30; }
  return score;
}

export async function recallMemory(projectPath: string, requestedName: string | undefined, query: string, limit = 10): Promise<MemoryRecallResult> {
  if (!query.trim()) throw new Error("Recall query must not be empty.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Recall limit must be an integer from 1 to 50.");
  const inspection = await inspectMemory(projectPath, requestedName); if (!inspection.latest) throw new Error(`Project memory '${inspection.manifest.name}' has no synchronized revision yet.`);
  const candidates: MemoryRecallResultItem[] = [];
  inspection.latest.memoryState.knowledge.forEach((item, index) => candidates.push({ kind: "knowledge", score: scoreMemoryRecall(query, `${item.content} ${item.rationale ?? ""}`, item.files, index / 1000), content: item.content + (item.rationale ? ` Rationale: ${item.rationale}` : ""), category: item.category, files: item.files, sourceCli: item.provenance.at(-1)?.sourceCli, sourceSessionId: item.provenance.at(-1)?.sourceSessionId, timestamp: item.provenance.at(-1)?.capturedAt, revision: item.provenance.at(-1)?.revisionId }));
  inspection.latest.memoryState.taskEpochs.forEach((epoch, index) => candidates.push({ kind: "epoch", score: scoreMemoryRecall(query, `${epoch.sessionSummary} ${epoch.goal ?? ""} ${epoch.nextAction ?? ""}`, epoch.taskState.filesMentioned, index / 100), content: `${epoch.outcome}: ${epoch.sessionSummary}`, files: epoch.taskState.filesMentioned, sourceCli: epoch.sourceCli, sourceSessionId: epoch.sourceSessionId, timestamp: epoch.updatedAt, revision: epoch.revisionIds.at(-1) }));
  const root = await storeRoot(projectPath, false); const manifest = inspection.manifest;
  for (let index = 0; index < manifest.revisions.length; index += 1) {
    const revision = manifest.revisions[index]; const conversationPath = path.join(root, manifest.name, "revisions", revision.id, "conversation.jsonl");
    try {
      const stats = await fs.lstat(conversationPath); if (stats.isSymbolicLink() || !stats.isFile()) continue;
      for (const line of (await fs.readFile(conversationPath, "utf8")).split("\n")) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as ArchivedMemoryMessage;
        candidates.push({ kind: "conversation", score: scoreMemoryRecall(query, message.content, [], index / 100), content: message.content, sourceCli: message.sourceCli, sourceSessionId: message.sourceSessionId, timestamp: message.timestamp, revision: revision.id });
      }
    } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  }
  const ranked = candidates.filter((item) => item.score > 0).sort((left, right) => right.score - left.score || (right.timestamp ?? "").localeCompare(left.timestamp ?? ""));
  const results: MemoryRecallResultItem[] = []; let bytes = 0; let truncated = ranked.length > limit;
  for (const item of ranked.slice(0, limit)) {
    const bounded = { ...item, content: item.content.length > 1600 ? `${item.content.slice(0, 1599)}…` : item.content };
    const itemBytes = Buffer.byteLength(JSON.stringify(bounded), "utf8"); if (bytes + itemBytes > RECALL_MAX_OUTPUT_BYTES) { truncated = true; break; } bytes += itemBytes; results.push(bounded);
  }
  return { schemaVersion: 2, memory: manifest.name, query, limit, results, truncated };
}

export function formatMemoryList(entries: MemoryListEntry[]): string {
  if (entries.length === 0) return "No project memories found. The first explicit sync or attach creates 'default'.";
  return entries.map((entry) => [`${entry.active ? "*" : " "} ${entry.name}`, `  Schema: v${entry.schemaVersion}`, `  Revisions: ${entry.revisionCount}`, `  Updated: ${entry.updatedAt}`, entry.outcome ? `  Outcome: ${entry.outcome}` : undefined, entry.sourceCli ? `  Latest source: ${entry.sourceCli}` : undefined, entry.openAttachId ? `  Open attach: ${entry.openAttachId} (${entry.openAttachTarget})` : undefined, entry.nextAction ? `  Next action: ${entry.nextAction}` : undefined].filter(Boolean).join("\n")).join("\n\n");
}

export function formatMemoryInspection(inspection: MemoryInspection): string {
  const lines = [`Project memory: ${inspection.manifest.name}${inspection.active ? " (active)" : ""}`, `Schema: v${inspection.manifest.schemaVersion}${inspection.compatibilityView ? " (transient compatibility view)" : ""}`, `Revisions: ${inspection.manifest.revisionCount}`, `Updated: ${inspection.manifest.updatedAt}`];
  if (inspection.manifest.goal) lines.push(`Goal: ${inspection.manifest.goal}`);
  if (!inspection.latest) { lines.push("Status: waiting for first sync"); return lines.join("\n"); }
  lines.push(`Latest revision: ${inspection.latest.revision.id}`, `Source: ${inspection.latest.revision.sourceCli}:${inspection.latest.revision.sourceSessionId ?? "unknown"}`, `Outcome: ${inspection.latest.state.outcome}`, `Next action: ${inspection.latest.state.nextAction ?? "not available"}`, `Knowledge items: ${inspection.latest.memoryState.knowledge.length}`, `Task epochs: ${inspection.latest.memoryState.taskEpochs.length}`, `Repository drift: ${inspection.latest.drift.detected ? inspection.latest.drift.categories.join(", ") : "none"}`, `Readiness: ${inspection.latest.readiness.level}`);
  if (inspection.openRuns.length > 0) lines.push(`Open attach: ${inspection.openRuns[0].id} (${inspection.openRuns[0].targetCli}, ${inspection.openRuns[0].status})`);
  return lines.join("\n");
}

export function formatMemoryRecall(result: MemoryRecallResult): string {
  if (result.results.length === 0) return `No local memory matches found for '${result.query}'.`;
  return result.results.map((item, index) => `${index + 1}. [${item.kind}${item.category ? `:${item.category}` : ""}] ${item.content}\n   source: ${item.sourceCli ?? "unknown"}:${item.sourceSessionId ?? "unknown"}${item.revision ? ` revision ${item.revision}` : ""}`).join("\n\n") + (result.truncated ? "\n\nResults were bounded; narrow the query for more detail." : "");
}
