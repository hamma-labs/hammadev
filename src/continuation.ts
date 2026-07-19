import path from "node:path";
import { ClaudeAdapter } from "./adapters/claude/index.js";
import { CodexAdapter } from "./adapters/codex/index.js";
import { GrokAdapter } from "./adapters/grok/index.js";
import {
  rankCandidates,
  SessionCandidate,
} from "./core/quality.js";
import { HammaSession, SourceCli } from "./core/schema.js";
import {
  reconstructHandoffState,
  type HandoffResult,
} from "./core/handoff.js";
import type { HandoffReadinessResult } from "./core/readiness.js";
import type { HammaTaskState } from "./core/state.js";

export type ContinuationAgent = "codex" | "claude" | "grok";

export interface ContinuationDecision {
  schemaVersion: 1;
  projectPath: string;
  targetCli: ContinuationAgent;
  excludedSources: ContinuationAgent[];
  selected: SessionCandidate;
  candidates: SessionCandidate[];
  explanation: string[];
}

export interface ContinuationOptions {
  codexHome?: string;
  claudeHomes?: string[];
  grokHome?: string;
  includeTargetSource?: boolean;
}

export interface ContinuationPreflight {
  schemaVersion: 1;
  outcome: HammaTaskState["outcome"];
  shouldCreateHandoff: boolean;
  requiresForce: boolean;
  nextAction?: string;
  taskCount: number;
  readiness: HandoffReadinessResult;
  recommendation: string;
  taskEpoch?: HammaTaskState["current"]["taskEpoch"];
}

export interface ContinuationPreflightEvaluation {
  state: HammaTaskState;
  preflight: ContinuationPreflight;
}

export interface CompactContinuationResponse {
  schemaVersion: 1;
  mode: "preflight" | "result";
  projectPath: string;
  targetCli: ContinuationAgent;
  selection: {
    sourceCli: SourceCli;
    sessionId?: string;
    lastUpdatedAt: string;
    score: number;
    confidence: SessionCandidate["confidence"];
    resumable: boolean;
    signals: string[];
    warnings: string[];
    reason: string;
    candidateCount: number;
    excludedSources: ContinuationAgent[];
  };
  preflight: {
    outcome: ContinuationPreflight["outcome"];
    shouldCreateHandoff: boolean;
    requiresForce: boolean;
    nextAction?: string;
    readiness: {
      level: HandoffReadinessResult["level"];
      warnings: string[];
      warningCount: number;
      blockers: string[];
      blockerCount: number;
    };
    recommendation: string;
  };
  handoff: null | {
    taskId: string;
    outcome: HandoffResult["outcome"];
    handoffPath: string;
    statePath: string;
    relativeHandoffPath: string;
    readinessLevel: HandoffReadinessResult["level"];
    initialContextBytes: number;
    warnings: string[];
    warningCount: number;
    suggestedCommand: string;
  };
}

const COMPACT_LIST_LIMIT = 4;
const COMPACT_TEXT_LIMIT = 320;

function compactText(value: string, max = COMPACT_TEXT_LIMIT): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function compactList(values: string[]): string[] {
  return values
    .slice(0, COMPACT_LIST_LIMIT)
    .map((value) => compactText(value));
}

/**
 * Build the bounded, transcript-free JSON contract consumed by agent skills.
 * The default --json response remains unchanged for existing integrations.
 */
export function compactContinuationResponse(
  decision: ContinuationDecision,
  preflight: ContinuationPreflight,
  handoff: HandoffResult | null,
  mode: CompactContinuationResponse["mode"]
): CompactContinuationResponse {
  return {
    schemaVersion: 1,
    mode,
    projectPath: decision.projectPath,
    targetCli: decision.targetCli,
    selection: {
      sourceCli: decision.selected.sourceCli,
      sessionId: decision.selected.sessionId,
      lastUpdatedAt: decision.selected.lastUpdatedAt,
      score: decision.selected.score,
      confidence: decision.selected.confidence,
      resumable: decision.selected.resumable,
      signals: compactList(decision.selected.signals),
      warnings: compactList(decision.selected.reasons),
      reason: compactText(decision.explanation[0] ?? "Selected the strongest resumable project session."),
      candidateCount: decision.candidates.length,
      excludedSources: decision.excludedSources,
    },
    preflight: {
      outcome: preflight.outcome,
      shouldCreateHandoff: preflight.shouldCreateHandoff,
      requiresForce: preflight.requiresForce,
      nextAction: preflight.nextAction
        ? compactText(preflight.nextAction, 500)
        : undefined,
      readiness: {
        level: preflight.readiness.level,
        warnings: compactList(preflight.readiness.warnings),
        warningCount: preflight.readiness.warnings.length,
        blockers: compactList(preflight.readiness.blockers),
        blockerCount: preflight.readiness.blockers.length,
      },
      recommendation: compactText(preflight.recommendation),
    },
    handoff: handoff
      ? {
          taskId: handoff.taskId,
          outcome: handoff.outcome,
          handoffPath: handoff.handoffPath,
          statePath: handoff.statePath,
          relativeHandoffPath: handoff.relativeHandoffPath,
          readinessLevel: handoff.readiness.level,
          initialContextBytes: handoff.contextBudget.bytes,
          warnings: compactList(handoff.warnings),
          warningCount: handoff.warnings.length,
          suggestedCommand: compactText(handoff.suggestedCommand, 500),
        }
      : null,
  };
}

const SUPPORTED_AGENTS = new Set<ContinuationAgent>([
  "codex",
  "claude",
  "grok",
]);

export function parseContinuationAgent(value: string): ContinuationAgent {
  const normalized = value.toLowerCase() as ContinuationAgent;
  if (!SUPPORTED_AGENTS.has(normalized)) {
    throw new Error(
      `Unsupported continuation target '${value}'. Use codex, claude, or grok.`
    );
  }
  return normalized;
}

export function chooseContinuationCandidate(
  candidates: SessionCandidate[],
  targetCli: ContinuationAgent,
  includeTargetSource = false
): Pick<ContinuationDecision, "selected" | "candidates" | "excludedSources" | "explanation"> {
  const excludedSources = includeTargetSource ? [] : [targetCli];
  const eligible = candidates.filter(
    (candidate) => includeTargetSource || candidate.sourceCli !== targetCli
  );
  const ranked = rankCandidates(eligible);
  const selected = ranked.find((candidate) => candidate.resumable);
  if (!selected) {
    const suffix = includeTargetSource
      ? ""
      : ` Sessions from the target agent '${targetCli}' were excluded to avoid selecting the active continuation session.`;
    throw new Error(`No resumable cross-agent session was found.${suffix}`);
  }

  const explanation = [
    `Selected the highest-ranked resumable ${selected.sourceCli} session across ${ranked.length} eligible candidate${ranked.length === 1 ? "" : "s"}.`,
    `Quality score ${selected.score} (${selected.confidence} confidence); signals: ${selected.signals.join(", ") || "none"}.`,
    includeTargetSource
      ? "Sessions from the target agent were included by request."
      : `Excluded ${targetCli} sessions to avoid a self-referential continuation.`,
    "Quality ranks before recency; recency only breaks equal-score ties.",
  ];

  return { selected, candidates: ranked, excludedSources, explanation };
}

export async function decideContinuation(
  projectPath: string,
  targetCli: ContinuationAgent,
  options: ContinuationOptions = {}
): Promise<ContinuationDecision> {
  const resolvedProject = path.resolve(projectPath);
  const [codex, claude, grok] = await Promise.all([
    CodexAdapter.listProject(resolvedProject, options.codexHome),
    ClaudeAdapter.listProject(resolvedProject, options.claudeHomes),
    GrokAdapter.listProject(resolvedProject, options.grokHome),
  ]);
  const choice = chooseContinuationCandidate(
    [...codex.candidates, ...claude.candidates, ...grok.candidates],
    targetCli,
    options.includeTargetSource
  );
  return {
    schemaVersion: 1,
    projectPath: resolvedProject,
    targetCli,
    ...choice,
  };
}

export async function loadContinuationSession(
  candidate: SessionCandidate,
  grokHome?: string
): Promise<HammaSession> {
  const source = candidate.sourceCli as SourceCli;
  if (source === "codex") return CodexAdapter.inspect(candidate.path);
  if (source === "claude") return ClaudeAdapter.inspect(candidate.path);
  if (source === "grok") return GrokAdapter.inspect(candidate.path, grokHome);
  throw new Error(`Unsupported continuation source '${source}'.`);
}

export function evaluateContinuationPreflight(
  session: HammaSession,
  targetCli: ContinuationAgent,
  projectPath: string
): ContinuationPreflightEvaluation {
  const state = reconstructHandoffState(session, targetCli, projectPath);
  const readiness = state.readiness!;
  const shouldCreateHandoff =
    state.outcome === "actionable" && readiness.level !== "not_ready";
  let recommendation: string;
  if (state.outcome === "completed") {
    recommendation =
      "No continuation required. The latest task epoch is already complete.";
  } else if (state.outcome === "blocked") {
    recommendation =
      "Resolve the recorded blocker before launching another coding agent.";
  } else if (state.outcome === "ambiguous") {
    recommendation =
      "Clarify the next action before creating a continuation handoff.";
  } else if (readiness.level === "not_ready") {
    recommendation =
      "Review the reconstructed state before continuing; critical readiness blockers were detected.";
  } else if (readiness.level === "review_recommended") {
    recommendation =
      "The task is actionable, but review the reported warnings before continuing.";
  } else {
    recommendation = "The task is actionable and ready for handoff creation.";
  }
  return {
    state,
    preflight: {
      schemaVersion: 1,
      outcome: state.outcome,
      shouldCreateHandoff,
      requiresForce: !shouldCreateHandoff,
      nextAction: state.nextAction,
      taskCount: state.tasks.length,
      readiness,
      recommendation,
      taskEpoch: state.current.taskEpoch,
    },
  };
}
