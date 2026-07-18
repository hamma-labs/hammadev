import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ClaudeAdapter } from "../adapters/claude/index.js";
import { CodexAdapter } from "../adapters/codex/index.js";
import { GrokAdapter } from "../adapters/grok/index.js";
import { loadContinuationSession } from "../continuation.js";
import { loadSession } from "../session-loader.js";
import {
  computeRepoState,
  ensureGitignore,
  renderHandoffWithSizeGuard,
  renderToolHistoryJsonl,
} from "./handoff.js";
import {
  captureGitRepositorySnapshot,
  compareRepositorySnapshots,
  RepositoryDriftCategory,
  RepositoryDriftResult,
} from "./git-snapshot.js";
import { normalizeFilesMentioned } from "./files.js";
import { rankCandidates, scoreSession, SessionCandidate } from "./quality.js";
import {
  assessHandoffReadiness,
  HandoffReadinessResult,
} from "./readiness.js";
import { HammaSession } from "./schema.js";
import {
  extractTaskState,
  HammaEvidenceItem,
  HammaTaskLedgerItem,
  HammaTaskState,
} from "./state.js";

const MEMORY_SCHEMA_VERSION = 1 as const;
const MEMORY_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REVISION_ID = /^\d{6}-\d{4}-\d{2}-\d{2}T[0-9-]+Z-[a-z0-9_-]+$/;

export interface MemoryRevisionSummary {
  id: string;
  parentRevision?: string;
  createdAt: string;
  sourceCli: string;
  sourceSessionId?: string;
  sourceLastUpdatedAt?: string;
  sourceFingerprint: string;
  driftFromParent: RepositoryDriftCategory[];
  warnings: string[];
}

export interface ProjectMemoryManifest {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
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
  revisionCount: number;
  updatedAt: string;
  latestRevision?: string;
  sourceCli?: string;
  nextAction?: string;
}

export interface MemoryInspection {
  schemaVersion: 1;
  active: boolean;
  manifest: ProjectMemoryManifest;
  latest?: {
    revision: MemoryRevisionSummary;
    revisionPath: string;
    state: HammaTaskState;
    drift: RepositoryDriftResult;
    readiness: HandoffReadinessResult;
  };
}

export interface MemorySyncOptions {
  source?: string;
  useGitignore?: boolean;
}

export interface MemorySyncResult {
  schemaVersion: 1;
  updated: boolean;
  memory: string;
  projectPath: string;
  revision?: MemoryRevisionSummary;
  revisionPath?: string;
  statePath?: string;
  handoffPath?: string;
  toolHistoryPath?: string;
  selection: {
    mode: "explicit" | "automatic";
    sourceCli?: string;
    sourceSessionId?: string;
    explanation: string[];
  };
  warnings: string[];
  reason?: string;
}

export interface MemoryResumeResult {
  schemaVersion: 1;
  memory: string;
  targetCli: string;
  projectPath: string;
  revision: string;
  statePath: string;
  handoffPath: string;
  toolHistoryPath: string;
  drift: RepositoryDriftResult;
  readiness: HandoffReadinessResult;
  suggestedCommand: string;
}

function assertMemoryName(name: string): void {
  if (!MEMORY_NAME.test(name)) {
    throw new Error(
      `Invalid memory name '${name}'. Use 1-64 lowercase letters, numbers, underscores, or hyphens.`
    );
  }
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
    throw new Error(`Memory storage directory is not a safe directory: ${directory}`);
  }
  const canonical = await fs.realpath(directory);
  if (canonical !== directory || (parent && !isWithin(parent, canonical))) {
    throw new Error(`Memory storage contains symbolic-link components: ${directory}`);
  }
}

async function canonicalProject(projectPath: string): Promise<string> {
  const resolved = path.resolve(projectPath);
  await assertSafeDirectory(resolved);
  return resolved;
}

export function resolveMemoryProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  try {
    return path.resolve(
      execFileSync("git", ["-C", resolved, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      }).trim()
    );
  } catch {
    return resolved;
  }
}

async function ensureDirectory(directory: string, parent: string): Promise<void> {
  try {
    await fs.mkdir(directory);
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
  }
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
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
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

async function readJson<T>(target: string): Promise<T> {
  const stats = await fs.lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Memory metadata is not a safe file: ${target}`);
  }
  return JSON.parse(await fs.readFile(target, "utf8")) as T;
}

function memoryPath(root: string, name: string): string {
  assertMemoryName(name);
  return path.join(root, name);
}

async function activeMemoryName(root: string): Promise<string | undefined> {
  try {
    const active = await readJson<{ name?: string }>(path.join(root, "active.json"));
    if (!active.name) return undefined;
    assertMemoryName(active.name);
    return active.name;
  } catch (error: any) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function resolveMemoryName(root: string, name?: string): Promise<string> {
  if (name) {
    assertMemoryName(name);
    return name;
  }
  const active = await activeMemoryName(root);
  if (!active) {
    throw new Error("No active project memory. Run `hamma memory start <name>` first.");
  }
  return active;
}

async function readManifest(root: string, name: string): Promise<ProjectMemoryManifest> {
  const directory = memoryPath(root, name);
  await assertSafeDirectory(directory, root);
  const manifest = await readJson<ProjectMemoryManifest>(
    path.join(directory, "memory.json")
  );
  const expectedProject = path.dirname(path.dirname(root));
  if (
    manifest.schemaVersion !== MEMORY_SCHEMA_VERSION ||
    manifest.name !== name ||
    path.resolve(manifest.projectPath) !== expectedProject
  ) {
    throw new Error(`Memory '${name}' has unsupported or inconsistent metadata.`);
  }
  return manifest;
}

async function setActive(root: string, name: string): Promise<void> {
  await writeJsonAtomic(path.join(root, "active.json"), {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    name,
    updatedAt: new Date().toISOString(),
  });
}

export async function startMemory(
  projectPath: string,
  name: string,
  goal?: string,
  useGitignore = true
): Promise<ProjectMemoryManifest> {
  assertMemoryName(name);
  const project = await canonicalProject(projectPath);
  const root = await storeRoot(project, true);
  const directory = memoryPath(root, name);
  try {
    await fs.mkdir(directory);
  } catch (error: any) {
    if (error.code === "EEXIST") {
      throw new Error(`Project memory '${name}' already exists.`);
    }
    throw error;
  }
  try {
    await assertSafeDirectory(directory, root);
    await ensureDirectory(path.join(directory, "revisions"), directory);
    const createdAt = new Date().toISOString();
    const manifest: ProjectMemoryManifest = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      name,
      projectPath: project,
      createdAt,
      updatedAt: createdAt,
      goal: goal?.trim() || undefined,
      revisionCount: 0,
      revisions: [],
    };
    await writeJsonAtomic(path.join(directory, "memory.json"), manifest);
    await setActive(root, name);
    if (useGitignore) await ensureGitignore(project);
    return manifest;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function latestState(
  root: string,
  manifest: ProjectMemoryManifest
): Promise<{ revision: MemoryRevisionSummary; path: string; state: HammaTaskState } | undefined> {
  if (!manifest.latestRevision) return undefined;
  if (!REVISION_ID.test(manifest.latestRevision)) {
    throw new Error(`Memory '${manifest.name}' has an invalid latest revision id.`);
  }
  const revision = manifest.revisions.find((item) => item.id === manifest.latestRevision);
  if (!revision) throw new Error(`Memory '${manifest.name}' latest revision metadata is missing.`);
  const directory = path.join(root, manifest.name, "revisions", revision.id);
  await assertSafeDirectory(directory, path.join(root, manifest.name));
  const state = await readJson<HammaTaskState>(path.join(directory, "state.json"));
  return { revision, path: directory, state };
}

export async function listMemories(projectPath: string): Promise<MemoryListEntry[]> {
  let root: string;
  try {
    root = await storeRoot(projectPath, false);
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const active = await activeMemoryName(root);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const memories: MemoryListEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !MEMORY_NAME.test(entry.name)) continue;
    const manifest = await readManifest(root, entry.name);
    const latest = await latestState(root, manifest);
    memories.push({
      name: manifest.name,
      active: manifest.name === active,
      revisionCount: manifest.revisionCount,
      updatedAt: manifest.updatedAt,
      latestRevision: manifest.latestRevision,
      sourceCli: latest?.revision.sourceCli,
      nextAction: latest?.state.nextAction,
    });
  }
  return memories.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name)
  );
}

export async function inspectMemory(
  projectPath: string,
  requestedName?: string
): Promise<MemoryInspection> {
  const project = await canonicalProject(projectPath);
  const root = await storeRoot(project, false);
  const name = await resolveMemoryName(root, requestedName);
  const manifest = await readManifest(root, name);
  const active = (await activeMemoryName(root)) === name;
  const latest = await latestState(root, manifest);
  if (!latest) return { schemaVersion: 1, active, manifest };
  const current = captureGitRepositorySnapshot(project, latest.state.filesMentioned);
  const drift = compareRepositorySnapshots(latest.state.repoState.snapshot, current);
  return {
    schemaVersion: 1,
    active,
    manifest,
    latest: {
      revision: latest.revision,
      revisionPath: latest.path,
      state: latest.state,
      drift,
      readiness: assessHandoffReadiness(latest.state, drift),
    },
  };
}

function sourceFingerprint(session: HammaSession): string {
  return createHash("sha256")
    .update(JSON.stringify({ messages: session.messages, shellCommands: session.shellCommands }))
    .digest("hex");
}

async function automaticCandidate(
  projectPath: string,
  latest?: MemoryRevisionSummary
): Promise<{ candidate: SessionCandidate; explanation: string[] }> {
  const [codex, claude, grok] = await Promise.all([
    CodexAdapter.listProject(projectPath),
    ClaudeAdapter.listProject(projectPath),
    GrokAdapter.listProject(projectPath),
  ]);
  let candidates = rankCandidates([
    ...codex.candidates,
    ...claude.candidates,
    ...grok.candidates,
  ]).filter((candidate) => candidate.resumable);
  if (latest?.sourceLastUpdatedAt) {
    const newer = candidates.filter(
      (candidate) =>
        candidate.lastUpdatedAt > latest.sourceLastUpdatedAt! ||
        (candidate.sourceCli === latest.sourceCli &&
          candidate.sessionId === latest.sourceSessionId)
    );
    if (newer.length === 0) {
      throw new Error(
        "No current or newer resumable session was found relative to the latest memory revision. Choose an exact session with `--source` if this is intentional."
      );
    }
    candidates = newer;
  }
  candidates.sort((left, right) =>
    right.lastUpdatedAt.localeCompare(left.lastUpdatedAt) ||
    right.score - left.score
  );
  const candidate = candidates[0];
  if (!candidate) {
    throw new Error(
      "No resumable project session is available to sync. Pass `--source <agent>:<id>` to choose explicitly."
    );
  }
  const tied = candidates[1];
  if (tied && tied.lastUpdatedAt === candidate.lastUpdatedAt &&
      tied.sourceCli !== candidate.sourceCli) {
    throw new Error(
      "Multiple agents have equally recent resumable sessions. Pass `--source <agent>:<id>` to avoid syncing the wrong session."
    );
  }
  return {
    candidate,
    explanation: [
      `Selected the most recently updated resumable project session (${candidate.sourceCli}).`,
      `Quality score ${candidate.score} (${candidate.confidence} confidence).`,
      "Self-referential Hamma handoff sessions and low-confidence sessions were excluded.",
    ],
  };
}

function evidenceKey(item: HammaEvidenceItem): string {
  return [item.source, item.kind, item.status, item.summary, item.command ?? "", item.exitCode ?? ""].join("\0");
}

function uniqueEvidence(items: HammaEvidenceItem[]): HammaEvidenceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = evidenceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-100);
}

function taskKey(task: HammaTaskLedgerItem): string {
  const text = (task.title ?? task.summary)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return task.id ? `id:${task.id}:${text}` : `text:${text}`;
}

function uniqueStrings(values: string[], limit: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(-limit);
}

export function mergeMemoryState(
  previous: HammaTaskState | undefined,
  current: HammaTaskState
): { state: HammaTaskState; warnings: string[] } {
  if (!previous) return { state: current, warnings: [] };
  const warnings: string[] = [];
  const tasks = new Map(previous.tasks.map((task) => [taskKey(task), task]));
  for (const incoming of current.tasks) {
    const key = taskKey(incoming);
    const existing = tasks.get(key);
    if (!existing) {
      if (
        incoming.id &&
        [...tasks.values()].some((task) => task.id === incoming.id)
      ) {
        warnings.push(
          `Task id #${incoming.id} was reused with different text; both entries were retained for review.`
        );
      }
      tasks.set(key, incoming);
      continue;
    }
    let status = incoming.status;
    if (existing.status === "completed" && incoming.status !== "completed") {
      status = "completed";
      warnings.push(
        `Preserved completed status for '${incoming.title ?? incoming.summary}' because the newer session did not provide an explicit compatible completion transition.`
      );
    }
    tasks.set(key, {
      ...incoming,
      status,
      evidence: uniqueStrings([...existing.evidence, ...incoming.evidence], 30),
      risks: uniqueStrings([...existing.risks, ...incoming.risks], 20),
      filesMentioned: normalizeFilesMentioned([
        ...existing.filesMentioned,
        ...incoming.filesMentioned,
      ]),
    });
  }
  const mergedTasks = [...tasks.values()];
  const hasBlocked = mergedTasks.some((task) => task.status === "blocked");
  const hasRemaining = mergedTasks.some((task) =>
    ["remaining", "in_progress", "unknown"].includes(task.status)
  );
  const outcome = hasBlocked
    ? "blocked"
    : hasRemaining
      ? "actionable"
      : current.outcome;
  const state: HammaTaskState = {
    ...current,
    outcome,
    goal: previous.goal ?? current.goal,
    nextAction:
      outcome === "completed"
        ? undefined
        : current.nextAction ?? previous.nextAction,
    tasks: mergedTasks,
    verification: uniqueStrings(
      [...previous.verification, ...current.verification],
      40
    ),
    evidence: uniqueEvidence([...previous.evidence, ...current.evidence]),
    risks: uniqueStrings([...previous.risks, ...current.risks], 40),
    filesMentioned: normalizeFilesMentioned([
      ...previous.filesMentioned,
      ...current.filesMentioned,
    ]),
  };
  return { state, warnings };
}

function renderMemoryHandoff(
  state: HammaTaskState,
  memoryName: string
): string {
  return renderHandoffWithSizeGuard(state)
    .replace("# Hamma Handoff", `# Hamma Project Memory: ${memoryName}`)
    .replace(
      "See timeline.md and state.json for the full picture.",
      "See state.json for the full structured memory state."
    )
    .replace(
      /Run `hamma show <task-id> --check-drift` when available/,
      `Run \`hamma memory show ${memoryName}\` when available`
    )
    .replace(
      /## References\n[\s\S]*$/,
      [
        "## References",
        "- Structured memory state: state.json",
        "- Tool execution cache: tool_history.jsonl",
        "- Revision metadata: revision.json",
        "- Full native or normalized transcripts are not copied into memory revisions.",
        "",
      ].join("\n")
    );
}

async function acquireLock(directory: string): Promise<string> {
  const lock = path.join(directory, ".sync-lock");
  try {
    await fs.mkdir(lock);
    return lock;
  } catch (error: any) {
    if (error.code === "EEXIST") {
      throw new Error("This memory is already being synchronized by another process.");
    }
    throw error;
  }
}

export async function syncMemory(
  projectPath: string,
  requestedName?: string,
  options: MemorySyncOptions = {}
): Promise<MemorySyncResult> {
  const project = await canonicalProject(projectPath);
  let root: string;
  try {
    root = await storeRoot(project, false);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error("No active project memory. Run `hamma memory start <name>` first.");
    }
    throw error;
  }
  const name = await resolveMemoryName(root, requestedName);
  const directory = memoryPath(root, name);
  // Validate the Hamma-owned directory before creating the lock. Otherwise a
  // replaced memory directory symlink could make lock acquisition write
  // outside the project before readManifest() gets a chance to reject it.
  await readManifest(root, name);
  const lock = await acquireLock(directory);
  try {
    const manifest = await readManifest(root, name);
    const previous = await latestState(root, manifest);
    let session: HammaSession;
    let candidate: SessionCandidate;
    let explanation: string[];
    const selectionMode = options.source ? "explicit" as const : "automatic" as const;
    if (options.source) {
      session = await loadSession(options.source, { projectPath: project });
      candidate = scoreSession(session, {
        sourceCli: session.meta.sourceCli,
        sessionId: session.meta.sourceSessionId,
        path: session.meta.sourcePath ?? options.source,
        projectPathHint: session.meta.projectPath,
        lastUpdatedAt: session.meta.lastUpdatedAt ?? session.meta.startedAt ?? new Date(0).toISOString(),
      });
      explanation = [
        `Used explicitly selected ${session.meta.sourceCli} session ${session.meta.sourceSessionId}.`,
        `Quality score ${candidate.score} (${candidate.confidence} confidence); explicit selection was preserved.`,
      ];
    } else {
      const selected = await automaticCandidate(project, previous?.revision);
      candidate = selected.candidate;
      explanation = selected.explanation;
      session = await loadContinuationSession(candidate);
    }
    session.meta.projectPath = project;
    const fingerprint = sourceFingerprint(session);
    if (previous?.revision.sourceFingerprint === fingerprint) {
      await setActive(root, name);
      return {
        schemaVersion: 1,
        updated: false,
        memory: name,
        projectPath: project,
        selection: {
          mode: selectionMode,
          sourceCli: session.meta.sourceCli,
          sourceSessionId: session.meta.sourceSessionId,
          explanation,
        },
        warnings: [],
        reason: "The selected session content matches the latest memory revision.",
      };
    }

    const currentBefore = captureGitRepositorySnapshot(
      project,
      previous?.state.filesMentioned ?? []
    );
    const parentDrift = previous
      ? compareRepositorySnapshots(previous.state.repoState.snapshot, currentBefore)
      : undefined;
    const repoState = computeRepoState(project);
    repoState.snapshot = captureGitRepositorySnapshot(project);
    let extracted = extractTaskState(session, { targetCli: "memory", repoState });
    if (!previous && manifest.goal) extracted.goal = manifest.goal;
    const merged = mergeMemoryState(previous?.state, extracted);
    extracted = merged.state;
    repoState.snapshot = captureGitRepositorySnapshot(project, extracted.filesMentioned);
    extracted.repoState = repoState;
    extracted.project.targetCli = "memory";
    extracted.references = {
      fullSession: "(not stored in memory revisions)",
      timeline: "(not stored in memory revisions)",
      commands: "tool_history.jsonl",
      redactionReport: "(not stored in memory revisions)",
    };
    extracted.readiness = assessHandoffReadiness(
      extracted,
      compareRepositorySnapshots(repoState.snapshot, repoState.snapshot)
    );

    const revisionNumber = manifest.revisionCount + 1;
    const timestamp = new Date().toISOString();
    const revisionId = `${String(revisionNumber).padStart(6, "0")}-${timestamp.replace(/[:.]/g, "-")}-${session.meta.sourceCli}`;
    const revisionsRoot = path.join(directory, "revisions");
    const finalRevisionPath = path.join(revisionsRoot, revisionId);
    const temporaryRevisionPath = path.join(revisionsRoot, `.tmp-${revisionId}`);
    await fs.mkdir(temporaryRevisionPath);
    const warnings = [...candidate.reasons, ...merged.warnings];
    if (parentDrift?.detected) {
      warnings.push(
        `Repository differences from the parent revision were recorded: ${parentDrift.categories.join(", ")}.`
      );
    }
    const revision: MemoryRevisionSummary = {
      id: revisionId,
      parentRevision: manifest.latestRevision,
      createdAt: timestamp,
      sourceCli: session.meta.sourceCli,
      sourceSessionId: session.meta.sourceSessionId,
      sourceLastUpdatedAt: session.meta.lastUpdatedAt,
      sourceFingerprint: fingerprint,
      driftFromParent: parentDrift?.categories ?? ["none"],
      warnings,
    };
    try {
      await Promise.all([
        writeJsonAtomic(path.join(temporaryRevisionPath, "state.json"), extracted),
        writeJsonAtomic(path.join(temporaryRevisionPath, "revision.json"), revision),
        fs.writeFile(
          path.join(temporaryRevisionPath, "handoff.md"),
          renderMemoryHandoff(extracted, name),
          "utf8"
        ),
        fs.writeFile(
          path.join(temporaryRevisionPath, "tool_history.jsonl"),
          renderToolHistoryJsonl(session),
          "utf8"
        ),
      ]);
      await fs.rename(temporaryRevisionPath, finalRevisionPath);
    } catch (error) {
      await fs.rm(temporaryRevisionPath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const updatedManifest: ProjectMemoryManifest = {
      ...manifest,
      goal: manifest.goal ?? extracted.goal,
      updatedAt: timestamp,
      latestRevision: revisionId,
      revisionCount: revisionNumber,
      revisions: [...manifest.revisions, revision],
    };
    await writeJsonAtomic(path.join(directory, "memory.json"), updatedManifest);
    await setActive(root, name);
    if (options.useGitignore !== false) await ensureGitignore(project);
    return {
      schemaVersion: 1,
      updated: true,
      memory: name,
      projectPath: project,
      revision,
      revisionPath: finalRevisionPath,
      statePath: path.join(finalRevisionPath, "state.json"),
      handoffPath: path.join(finalRevisionPath, "handoff.md"),
      toolHistoryPath: path.join(finalRevisionPath, "tool_history.jsonl"),
      selection: {
        mode: selectionMode,
        sourceCli: session.meta.sourceCli,
        sourceSessionId: session.meta.sourceSessionId,
        explanation,
      },
      warnings,
    };
  } finally {
    await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function resumeMemory(
  projectPath: string,
  requestedName: string | undefined,
  targetCli: string
): Promise<MemoryResumeResult> {
  const inspection = await inspectMemory(projectPath, requestedName);
  if (!inspection.latest) {
    throw new Error(
      `Project memory '${inspection.manifest.name}' has no synchronized revision yet.`
    );
  }
  const relativeRevision = path.relative(
    inspection.manifest.projectPath,
    inspection.latest.revisionPath
  );
  const statePath = path.join(inspection.latest.revisionPath, "state.json");
  const handoffPath = path.join(inspection.latest.revisionPath, "handoff.md");
  const toolHistoryPath = path.join(
    inspection.latest.revisionPath,
    "tool_history.jsonl"
  );
  return {
    schemaVersion: 1,
    memory: inspection.manifest.name,
    targetCli,
    projectPath: inspection.manifest.projectPath,
    revision: inspection.latest.revision.id,
    statePath,
    handoffPath,
    toolHistoryPath,
    drift: inspection.latest.drift,
    readiness: inspection.latest.readiness,
    suggestedCommand:
      `${targetCli} "Resume Hamma project memory '${inspection.manifest.name}'. ` +
      `Read ${relativeRevision}/state.json, ${relativeRevision}/tool_history.jsonl, and ` +
      `${relativeRevision}/handoff.md. Reconcile with live Git state; the repository wins on conflict."`,
  };
}

export function formatMemoryList(entries: MemoryListEntry[]): string {
  if (entries.length === 0) return "No project memories found.";
  return entries.map((entry) => [
    `${entry.active ? "*" : " "} ${entry.name}`,
    `  Revisions: ${entry.revisionCount}`,
    `  Updated: ${entry.updatedAt}`,
    entry.sourceCli ? `  Latest source: ${entry.sourceCli}` : undefined,
    entry.nextAction ? `  Next action: ${entry.nextAction}` : undefined,
  ].filter(Boolean).join("\n")).join("\n\n");
}

export function formatMemoryInspection(inspection: MemoryInspection): string {
  const lines = [
    `Project memory: ${inspection.manifest.name}${inspection.active ? " (active)" : ""}`,
    `Revisions: ${inspection.manifest.revisionCount}`,
    `Updated: ${inspection.manifest.updatedAt}`,
  ];
  if (inspection.manifest.goal) lines.push(`Goal: ${inspection.manifest.goal}`);
  if (!inspection.latest) {
    lines.push("Status: waiting for first sync");
    return lines.join("\n");
  }
  lines.push(
    `Latest revision: ${inspection.latest.revision.id}`,
    `Source: ${inspection.latest.revision.sourceCli}:${inspection.latest.revision.sourceSessionId ?? "unknown"}`,
    `Outcome: ${inspection.latest.state.outcome}`,
    `Next action: ${inspection.latest.state.nextAction ?? "not available"}`,
    `Repository drift: ${inspection.latest.drift.detected ? inspection.latest.drift.categories.join(", ") : "none"}`,
    `Readiness: ${inspection.latest.readiness.level}`
  );
  return lines.join("\n");
}
