import { ClaudeAdapter } from "../adapters/claude/index.js";
import { CodexAdapter } from "../adapters/codex/index.js";
import { GrokAdapter } from "../adapters/grok/index.js";
import { loadSession, SupportedSourceCli } from "../session-loader.js";
import { HammaMemoryRun } from "./memory-state.js";
import {
  abandonMemory,
  attachMemory,
  checkpointMemory,
  finishMemory,
  inspectMemory,
  MemoryAttachResult,
  MemoryInspection,
  MemoryRecallResult,
  MemorySyncResult,
  MemoryWritebackResult,
  recallMemory,
  syncMemory,
} from "./memory.js";
import { SessionCandidate } from "./quality.js";
import { HammaTaskState } from "./state.js";

const AGENTS = new Set<SupportedSourceCli>(["codex", "claude", "grok"]);
const AMBIGUOUS_WINDOW_MS = 30_000;

export interface SimpleSourceSelection {
  agent: SupportedSourceCli;
  source: string;
  sessionId: string;
  lastUpdatedAt?: string;
  reason: string;
}

export interface SimpleSaveOptions {
  agent?: string;
  memory?: string;
  useGitignore?: boolean;
  onProgress?: (message: string) => void;
}

export interface SimpleSaveResult {
  schemaVersion: 1;
  operation: "save";
  memory: string;
  source: SimpleSourceSelection;
  mode: "sync" | "checkpoint";
  updated: boolean;
  revision?: string;
  attachId?: string;
  outcome?: HammaTaskState["outcome"];
  nextAction?: string;
  warnings: string[];
}

export interface SimpleSwitchOptions {
  from?: string;
  memory?: string;
  save?: boolean;
  useGitignore?: boolean;
  onProgress?: (message: string) => void;
}

export interface SimpleSwitchResult {
  schemaVersion: 1;
  operation: "switch";
  memory: string;
  target: SupportedSourceCli;
  saved: boolean;
  transferredClaim: boolean;
  source?: SimpleSourceSelection;
  attach: MemoryAttachResult;
}

export interface SimpleDoneOptions {
  agent?: string;
  memory?: string;
  outcome?: "completed" | "blocked";
  nextAction?: string;
  useGitignore?: boolean;
  onProgress?: (message: string) => void;
}

export interface SimpleDoneResult {
  schemaVersion: 1;
  operation: "done";
  memory: string;
  source: SimpleSourceSelection;
  outcome: "completed" | "blocked";
  attachId?: string;
  revision?: string;
  run?: HammaMemoryRun;
  warnings: string[];
}

function parseAgent(value: string, label = "agent"): SupportedSourceCli {
  const normalized = value.toLowerCase() as SupportedSourceCli;
  if (!AGENTS.has(normalized)) {
    throw new Error(`Unsupported ${label} '${value}'. Use codex, claude, or grok.`);
  }
  return normalized;
}

async function exactCurrentSource(
  projectPath: string,
  agent: SupportedSourceCli,
  reason: string
): Promise<SimpleSourceSelection> {
  const session = await loadSession(`${agent}:current`, { projectPath });
  return {
    agent,
    source: `${agent}:${session.meta.sourceSessionId}`,
    sessionId: session.meta.sourceSessionId,
    lastUpdatedAt: session.meta.lastUpdatedAt,
    reason,
  };
}

async function projectCandidates(projectPath: string): Promise<SessionCandidate[]> {
  const settled = await Promise.allSettled([
    CodexAdapter.listProject(projectPath),
    ClaudeAdapter.listProject(projectPath),
    GrokAdapter.listProject(projectPath),
  ]);
  return settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value.candidates : []
  );
}

async function agentProjectCandidates(
  projectPath: string,
  agent: SupportedSourceCli
): Promise<SessionCandidate[]> {
  if (agent === "codex") return (await CodexAdapter.listProject(projectPath)).candidates;
  if (agent === "claude") return (await ClaudeAdapter.listProject(projectPath)).candidates;
  return (await GrokAdapter.listProject(projectPath)).candidates;
}

function candidateTime(candidate: SessionCandidate): number {
  const time = Date.parse(candidate.lastUpdatedAt);
  return Number.isFinite(time) ? time : 0;
}

export async function detectSimpleSource(
  projectPath: string,
  options: {
    preferredAgent?: string;
    expectedAgent?: string;
    expectedRun?: HammaMemoryRun;
    excludeAgents?: SupportedSourceCli[];
    allowMissing?: boolean;
    hintOption?: "--agent" | "--from";
  } = {}
): Promise<SimpleSourceSelection | undefined> {
  const hintOption = options.hintOption ?? "--agent";
  if (options.expectedRun) {
    const expectedAgent = parseAgent(options.expectedRun.targetCli);
    if (options.preferredAgent && parseAgent(options.preferredAgent) !== expectedAgent) {
      throw new Error(
        `This task belongs to ${expectedAgent}, not ${options.preferredAgent}. Run the command from the attached ${expectedAgent} session.`
      );
    }
    if (options.expectedRun.targetSessionId) {
      const session = await loadSession(
        `${expectedAgent}:${options.expectedRun.targetSessionId}`,
        { projectPath }
      );
      return {
        agent: expectedAgent,
        source: `${expectedAgent}:${session.meta.sourceSessionId}`,
        sessionId: session.meta.sourceSessionId,
        lastUpdatedAt: session.meta.lastUpdatedAt,
        reason: "Recovered the exact child session previously bound to the attach claim.",
      };
    }
    const marker = `[HAMMA_ATTACH_ID:${options.expectedRun.id}]`;
    const candidates = (await agentProjectCandidates(projectPath, expectedAgent))
      .filter((candidate) => Boolean(candidate.sessionId))
      .sort((left, right) => candidateTime(right) - candidateTime(left));
    for (const candidate of candidates.slice(0, 30)) {
      try {
        const session = await loadSession(
          `${expectedAgent}:${candidate.sessionId}`,
          { projectPath }
        );
        if (session.messages.some((message) => message.content.includes(marker))) {
          return {
            agent: expectedAgent,
            source: `${expectedAgent}:${session.meta.sourceSessionId}`,
            sessionId: session.meta.sourceSessionId,
            lastUpdatedAt: session.meta.lastUpdatedAt,
            reason: "Matched the hidden attach marker to the exact launched child session.",
          };
        }
      } catch {
        // Continue checking bounded project candidates.
      }
    }
    // Auto-heal: the launched session is gone (crash/interrupt). Release the claim and continue.
    await abandonMemory(
      projectPath,
      undefined,
      options.expectedRun.id,
      "Released automatically: launched session was not found (likely interrupted)."
    );
    process.stderr.write("✓ Released stale task claim (session was interrupted). Continuing normally.\n");
    return exactCurrentSource(
      projectPath,
      expectedAgent,
      `Recovered after releasing orphaned claim for ${expectedAgent}.`
    );
  }
  if (options.preferredAgent) {
    return exactCurrentSource(
      projectPath,
      parseAgent(options.preferredAgent),
      `Used the ${options.preferredAgent.toLowerCase()} session selected by the user.`
    );
  }
  if (options.expectedAgent) {
    return exactCurrentSource(
      projectPath,
      parseAgent(options.expectedAgent),
      `Recovered the source agent from the open attach claim.`
    );
  }
  if (process.env.HAMMA_AGENT) {
    return exactCurrentSource(
      projectPath,
      parseAgent(process.env.HAMMA_AGENT, "HAMMA_AGENT"),
      "Used the agent declared by HAMMA_AGENT."
    );
  }

  const excluded = new Set(options.excludeAgents ?? []);
  const candidates = (await projectCandidates(projectPath))
    .filter((candidate) =>
      AGENTS.has(candidate.sourceCli as SupportedSourceCli) &&
      !excluded.has(candidate.sourceCli as SupportedSourceCli) &&
      candidate.resumable &&
      Boolean(candidate.sessionId) &&
      !candidate.signals.includes("hamma-meta")
    )
    .sort((left, right) =>
      candidateTime(right) - candidateTime(left) || right.score - left.score
    );
  const selected = candidates[0];
  if (!selected?.sessionId) {
    if (options.allowMissing) return undefined;
    const excludedHint = excluded.size > 0
      ? ` outside ${[...excluded].join(", ")}`
      : "";
    throw new Error(
      `Hamma could not identify a current resumable agent session${excludedHint}. Run again with ${hintOption} codex, ${hintOption} claude, or ${hintOption} grok.`
    );
  }
  const runnerUp = candidates.find((candidate) =>
    candidate.sourceCli !== selected.sourceCli
  );
  if (runnerUp && Math.abs(candidateTime(selected) - candidateTime(runnerUp)) <= AMBIGUOUS_WINDOW_MS) {
    const selectedTime = selected.lastUpdatedAt ?? "unknown";
    const runnerUpTime = runnerUp.lastUpdatedAt ?? "unknown";
    throw new Error(
      `Both ${selected.sourceCli} (updated ${selectedTime}) and ${runnerUp.sourceCli} (updated ${runnerUpTime}) have recently updated project sessions within ${AMBIGUOUS_WINDOW_MS / 1000}s of each other. ` +
      `Run again with ${hintOption} ${selected.sourceCli} or ${hintOption} ${runnerUp.sourceCli} to choose the intended one.`
    );
  }
  const selectedAgent = parseAgent(selected.sourceCli);
  return {
    agent: selectedAgent,
    source: `${selectedAgent}:${selected.sessionId}`,
    sessionId: selected.sessionId,
    lastUpdatedAt: selected.lastUpdatedAt,
    reason: `Detected the most recently updated resumable ${selected.sourceCli} session for this project.`,
  };
}

async function optionalInspection(
  projectPath: string,
  memory?: string
): Promise<MemoryInspection | undefined> {
  try {
    return await inspectMemory(projectPath, memory);
  } catch (error: any) {
    if (error.code === "ENOENT" || String(error.message).includes("No active project memory")) {
      return undefined;
    }
    throw error;
  }
}

function oneOpenRun(inspection?: MemoryInspection): HammaMemoryRun | undefined {
  if (!inspection || inspection.openRuns.length === 0) return undefined;
  if (inspection.openRuns.length > 1) {
    throw new Error("This memory has multiple open attach claims. Use `hamma memory show --json` to review them before continuing.");
  }
  return inspection.openRuns[0];
}

function revisionFrom(result: MemorySyncResult | MemoryWritebackResult): string | undefined {
  return result.revision?.id;
}

export async function simpleSave(
  projectPath: string,
  options: SimpleSaveOptions = {}
): Promise<SimpleSaveResult> {
  const progress = options.onProgress ?? (() => {});
  const inspection = await optionalInspection(projectPath, options.memory);
  const openRun = oneOpenRun(inspection);
  const source = await detectSimpleSource(projectPath, {
    preferredAgent: options.agent,
    expectedRun: openRun,
  });
  if (!source) throw new Error("No current agent session was found.");

  progress("Writing to project memory…");

  if (openRun) {
    const checkpoint = await checkpointMemory(
      projectPath,
      inspection?.manifest.name,
      openRun.id,
      { source: source.source, useGitignore: options.useGitignore }
    );
    const latest = await inspectMemory(projectPath, checkpoint.memory);
    return {
      schemaVersion: 1,
      operation: "save",
      memory: checkpoint.memory,
      source,
      mode: "checkpoint",
      updated: checkpoint.updated,
      revision: revisionFrom(checkpoint),
      attachId: openRun.id,
      outcome: latest.latest?.state.outcome,
      nextAction: latest.latest?.state.nextAction,
      warnings: checkpoint.warnings,
    };
  }

  const synced = await syncMemory(projectPath, options.memory, {
    source: source.source,
    useGitignore: options.useGitignore,
  });
  const latest = await inspectMemory(projectPath, synced.memory);
  return {
    schemaVersion: 1,
    operation: "save",
    memory: synced.memory,
    source,
    mode: "sync",
    updated: synced.updated,
    revision: revisionFrom(synced),
    outcome: latest.latest?.state.outcome,
    nextAction: latest.latest?.state.nextAction,
    warnings: synced.warnings,
  };
}

export async function simpleSwitch(
  projectPath: string,
  targetValue: string,
  options: SimpleSwitchOptions = {}
): Promise<SimpleSwitchResult> {
  const target = parseAgent(targetValue, "target agent");
  const progress = options.onProgress ?? (() => {});
  let inspection = await optionalInspection(projectPath, options.memory);
  let openRun = oneOpenRun(inspection);
  let source: SimpleSourceSelection | undefined;
  let saved = false;
  let transferredClaim = false;

  if (openRun) {
    source = await detectSimpleSource(projectPath, {
      preferredAgent: options.from,
      expectedRun: openRun,
    });
    if (!source) throw new Error("No current attached session was found.");
    await checkpointMemory(projectPath, inspection?.manifest.name, openRun.id, {
      source: source.source,
      useGitignore: options.useGitignore,
    });
    await abandonMemory(
      projectPath,
      inspection?.manifest.name,
      openRun.id,
      `Transferred to ${target} through the simple switch workflow.`
    );
    saved = true;
    transferredClaim = true;
    inspection = await inspectMemory(projectPath, inspection?.manifest.name);
    openRun = undefined;
  } else if (options.save !== false) {
    source = await detectSimpleSource(projectPath, {
      preferredAgent: options.from,
      excludeAgents: options.from ? undefined : [target],
      allowMissing: true,
      hintOption: "--from",
    });
    if (!source && !inspection?.latest) {
      source = await detectSimpleSource(projectPath, {
        preferredAgent: options.from,
        hintOption: "--from",
      });
    }
    if (source && (
      Boolean(options.from) ||
      !inspection?.latest ||
      !source.lastUpdatedAt ||
      source.lastUpdatedAt > inspection.manifest.updatedAt
    )) {
      await syncMemory(projectPath, options.memory, {
        source: source.source,
        useGitignore: options.useGitignore,
      });
      saved = true;
      inspection = await inspectMemory(projectPath, options.memory);
    }
  }

  if (!inspection?.latest) {
    throw new Error(
      "There is no saved project memory to switch. Run `hamma save --agent <codex|claude|grok>` first."
    );
  }
  progress(`Preparing context for ${target}…`);
  const attach = await attachMemory(projectPath, inspection.manifest.name, target, {
    noSync: true,
    useGitignore: options.useGitignore,
  });
  return {
    schemaVersion: 1,
    operation: "switch",
    memory: attach.memory,
    target,
    saved,
    transferredClaim,
    source,
    attach,
  };
}

export async function simpleDone(
  projectPath: string,
  options: SimpleDoneOptions = {}
): Promise<SimpleDoneResult> {
  const progress = options.onProgress ?? (() => {});
  const inspection = await inspectMemory(projectPath, options.memory);
  const openRun = oneOpenRun(inspection);
  const outcome = options.outcome ?? "completed";
  const source = await detectSimpleSource(projectPath, {
    preferredAgent: options.agent,
    expectedRun: openRun,
  });
  if (!source) throw new Error("No current agent session was found.");

  progress("Closing the task epoch…");

  if (openRun) {
    const finished = await finishMemory(
      projectPath,
      inspection.manifest.name,
      openRun.id,
      {
        source: source.source,
        outcome,
        nextAction: options.nextAction,
        useGitignore: options.useGitignore,
      }
    );
    return {
      schemaVersion: 1,
      operation: "done",
      memory: finished.memory,
      source,
      outcome,
      attachId: openRun.id,
      revision: revisionFrom(finished),
      run: finished.run,
      warnings: finished.warnings,
    };
  }

  const synced = await syncMemory(projectPath, inspection.manifest.name, {
    source: source.source,
    forcedOutcome: outcome,
    forcedNextAction: outcome === "completed" ? null : options.nextAction,
    useGitignore: options.useGitignore,
  });
  return {
    schemaVersion: 1,
    operation: "done",
    memory: synced.memory,
    source,
    outcome,
    revision: revisionFrom(synced),
    warnings: synced.warnings,
  };
}

export async function simpleAsk(
  projectPath: string,
  query: string,
  memory?: string,
  limit = 5
): Promise<MemoryRecallResult> {
  return recallMemory(projectPath, memory, query, limit);
}
