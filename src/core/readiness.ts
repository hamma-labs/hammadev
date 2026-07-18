import { RepositoryDriftResult } from "./git-snapshot.js";
import {
  HammaEvidenceItem,
  HammaTaskState,
} from "./state.js";

export const READINESS_SCHEMA_VERSION = 1 as const;

export type HandoffReadinessLevel =
  | "ready"
  | "review_recommended"
  | "not_ready";

export type ReadinessDimensionStatus =
  | "strong"
  | "adequate"
  | "weak"
  | "critical";

export interface ReadinessDimension {
  status: ReadinessDimensionStatus;
  signals: string[];
}

export interface HandoffReadinessResult {
  schemaVersion: typeof READINESS_SCHEMA_VERSION;
  level: HandoffReadinessLevel;
  dimensions: {
    actionability: ReadinessDimension;
    evidenceQuality: ReadinessDimension;
    verification: ReadinessDimension;
    repositoryConsistency: ReadinessDimension;
    riskAndBlockerClarity: ReadinessDimension;
    contextCompleteness: ReadinessDimension;
  };
  signals: string[];
  warnings: string[];
  blockers: string[];
  recommendation: string;
}

type ReadinessState = Partial<HammaTaskState> | undefined;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function dimension(
  status: ReadinessDimensionStatus,
  signals: string[]
): ReadinessDimension {
  return { status, signals: unique(signals) };
}

function evidenceItems(state: ReadinessState): HammaEvidenceItem[] {
  return Array.isArray(state?.evidence) ? state.evidence : [];
}

export function assessHandoffReadiness(
  state: ReadinessState,
  drift?: RepositoryDriftResult
): HandoffReadinessResult {
  const signals: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  const actionSignals: string[] = [];
  const evidenceSignals: string[] = [];
  const verificationSignals: string[] = [];
  const repositorySignals: string[] = [];
  const riskSignals: string[] = [];
  const contextSignals: string[] = [];
  let actionCritical = false;

  if (!state) {
    blockers.push("Structured handoff state is missing or unreadable.");
    actionCritical = true;
  }

  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const remaining = tasks.filter((task) =>
    ["remaining", "in_progress"].includes(task.status)
  );
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const completed = tasks.filter((task) => task.status === "completed");
  const outcome = state?.outcome;
  const nextAction =
    state?.nextAction ??
    state?.current?.nextRecommendedTask ??
    (remaining.length > 0 ? remaining[0].title ?? remaining[0].summary : undefined);

  if (outcome === "blocked") {
    blockers.push("The reconstructed task outcome is blocked.");
    actionCritical = true;
    actionSignals.push("Blocked outcome recorded.");
  } else if (outcome === "ambiguous") {
    blockers.push("No unambiguous actionable next step was reconstructed.");
    actionCritical = true;
    actionSignals.push("Ambiguous outcome recorded.");
  } else if (outcome === "actionable") {
    if (nextAction) {
      actionSignals.push("Clear next action is available.");
      signals.push("Clear next action is available.");
    } else {
      blockers.push("The handoff is marked actionable but has no next action or remaining task.");
      actionCritical = true;
    }
  } else if (outcome === "completed") {
    actionSignals.push("Outcome is explicitly completed; no continuation action is required.");
    signals.push("Task outcome is explicitly completed.");
  } else if (state) {
    blockers.push("The handoff outcome is missing or unsupported.");
    actionCritical = true;
  }
  if (blockedTasks.length > 0 && outcome !== "blocked") {
    blockers.push(
      `${blockedTasks.length} blocked task${blockedTasks.length === 1 ? " is" : "s are"} present despite the ${outcome ?? "missing"} outcome.`
    );
    actionCritical = true;
  }

  if (remaining.length > 0) {
    actionSignals.push(`${remaining.length} remaining or in-progress task${remaining.length === 1 ? " is" : "s are"} identified.`);
  }

  const evidence = evidenceItems(state);
  const claims = evidence.filter((item) => item.source === "agent_claim");
  const passedCommands = evidence.filter(
    (item) => item.source === "command" && item.status === "passed"
  );
  const failedCommands = evidence.filter(
    (item) => item.source === "command" && item.status === "failed"
  );
  const unknownCommands = evidence.filter(
    (item) => item.source === "command" && item.status === "observed"
  );
  const confirmations = evidence.filter(
    (item) => item.source === "user_confirmation" && item.status === "confirmed"
  );
  const toolEvidence = evidence.filter((item) => item.source === "tool");
  const repositoryEvidence = evidence.filter(
    (item) => item.source === "repository"
  );

  if (failedCommands.length > 0) {
    blockers.push(
      `${failedCommands.length} verification command${failedCommands.length === 1 ? " has" : "s have"} an unresolved failed outcome.`
    );
    verificationSignals.push("Failed verification command evidence is present.");
  }
  if (passedCommands.length > 0) {
    const kinds = unique(passedCommands.map((item) => item.kind));
    const message = `${passedCommands.length} successful verification command${passedCommands.length === 1 ? "" : "s"} recorded (${kinds.join(", ")}).`;
    signals.push(message);
    evidenceSignals.push(message);
    verificationSignals.push(message);
  }
  if (unknownCommands.length > 0) {
    warnings.push(
      `${unknownCommands.length} verification command outcome${unknownCommands.length === 1 ? " is" : "s are"} unknown.`
    );
    verificationSignals.push("Verification command evidence with unknown outcomes is present.");
  }
  if (claims.length > 0) {
    evidenceSignals.push(`${claims.length} source-agent verification claim${claims.length === 1 ? "" : "s"} recorded.`);
    if (passedCommands.length === 0 && confirmations.length === 0) {
      warnings.push("Important verification information is supported only by source-agent claims.");
    }
  }
  if (confirmations.length > 0) {
    const message = `${confirmations.length} user confirmation${confirmations.length === 1 ? "" : "s"} recorded.`;
    signals.push(message);
    evidenceSignals.push(message);
  }
  if (toolEvidence.length > 0) {
    evidenceSignals.push(`${toolEvidence.length} additional tool observation${toolEvidence.length === 1 ? "" : "s"} recorded.`);
  }
  if (repositoryEvidence.length > 0) {
    evidenceSignals.push("Repository evidence is recorded.");
  }
  if (evidence.length === 0) {
    warnings.push("No provenance-tagged evidence is available; this may be an older handoff.");
    evidenceSignals.push("Provenance evidence is unavailable.");
  }
  if (completed.length > 0 && passedCommands.length === 0 && confirmations.length === 0) {
    warnings.push(
      `${completed.length} completed task${completed.length === 1 ? " lacks" : "s lack"} command or user-confirmed support.`
    );
  }

  if (passedCommands.length === 0 && failedCommands.length === 0 && unknownCommands.length === 0) {
    verificationSignals.push("No verification command outcomes were captured.");
    if (outcome === "completed") {
      warnings.push("The completed outcome has no captured verification command result.");
    }
  }

  const snapshot = state?.repoState?.snapshot;
  if (snapshot?.available) {
    const message = `Repository snapshot is available at ${snapshot.head?.slice(0, 12) ?? "an unborn HEAD"}.`;
    signals.push(message);
    repositorySignals.push(message);
  } else {
    warnings.push("A usable Git repository snapshot is not available.");
    repositorySignals.push("Repository snapshot is unavailable.");
  }

  if (drift) {
    if (drift.categories.includes("none")) {
      signals.push("No repository drift was detected.");
      repositorySignals.push("Recorded and current repository metadata match closely.");
    }
    if (drift.categories.includes("repository_unavailable")) {
      warnings.push("Repository drift could not be fully assessed.");
      repositorySignals.push("Repository comparison is unavailable.");
    }
    if (drift.categories.includes("working_tree_changed")) {
      warnings.push(
        `${drift.differences.changedFiles.length} working-tree file entr${drift.differences.changedFiles.length === 1 ? "y differs" : "ies differ"} between snapshots.`
      );
    }
    if (drift.categories.includes("head_changed")) {
      warnings.push("Repository HEAD differs from the handoff snapshot.");
    }
    if (drift.categories.includes("branch_changed")) {
      warnings.push("Repository branch or detached-HEAD state differs from the handoff snapshot.");
    }
    if (drift.categories.includes("relevant_files_changed")) {
      warnings.push(
        `${drift.differences.relevantFiles.length} handoff-referenced file digest${drift.differences.relevantFiles.length === 1 ? " differs" : "s differ"}.`
      );
    }
    repositorySignals.push(...drift.signals);
  }

  const risks = Array.isArray(state?.risks) ? state.risks : [];
  if (risks.length > 0) {
    warnings.push(`${risks.length} known risk${risks.length === 1 ? " requires" : "s require"} review.`);
    riskSignals.push(`${risks.length} known risk${risks.length === 1 ? " is" : "s are"} represented.`);
  } else {
    riskSignals.push("No explicit risks were extracted.");
  }
  if (outcome === "blocked") {
    riskSignals.push("A blocker is explicitly represented.");
  }

  if (state?.goal) {
    contextSignals.push("Original goal is available.");
  } else {
    warnings.push("Original goal is missing.");
    contextSignals.push("Original goal is unavailable.");
  }
  const files = Array.isArray(state?.filesMentioned) ? state.filesMentioned : [];
  if (files.length > 0) {
    contextSignals.push(`${files.length} relevant file reference${files.length === 1 ? " is" : "s are"} available.`);
  } else {
    warnings.push("No relevant files were identified.");
  }
  if (tasks.length > 0) {
    contextSignals.push(`${tasks.length} task ledger entr${tasks.length === 1 ? "y is" : "ies are"} available.`);
  } else if (outcome !== "completed") {
    warnings.push("No structured task ledger entries are available.");
  }
  if (!state?.project?.sourceCli || !state?.project?.sourceSessionId) {
    warnings.push("Source-agent metadata is incomplete.");
  } else {
    contextSignals.push("Source-agent metadata is available.");
  }

  const finalSignals = unique(signals);
  const finalWarnings = unique(warnings);
  const finalBlockers = unique(blockers);
  const level: HandoffReadinessLevel =
    finalBlockers.length > 0
      ? "not_ready"
      : finalWarnings.length > 0
        ? "review_recommended"
        : "ready";

  return {
    schemaVersion: READINESS_SCHEMA_VERSION,
    level,
    dimensions: {
      actionability: dimension(
        actionCritical
          ? "critical"
          : nextAction || outcome === "completed"
            ? "strong"
            : "weak",
        actionSignals
      ),
      evidenceQuality: dimension(
        evidence.length === 0 || (claims.length > 0 && passedCommands.length === 0 && confirmations.length === 0)
          ? "weak"
          : passedCommands.length > 0 || confirmations.length > 0
            ? "strong"
            : "adequate",
        evidenceSignals
      ),
      verification: dimension(
        failedCommands.length > 0
          ? "critical"
          : unknownCommands.length > 0 || passedCommands.length === 0
            ? "weak"
            : "strong",
        verificationSignals
      ),
      repositoryConsistency: dimension(
        !snapshot?.available || drift?.detected
          ? "weak"
          : drift
            ? "strong"
            : "adequate",
        repositorySignals
      ),
      riskAndBlockerClarity: dimension(
        finalBlockers.length > 0
          ? "critical"
          : risks.length > 0
            ? "adequate"
            : "strong",
        riskSignals
      ),
      contextCompleteness: dimension(
        state?.goal && tasks.length > 0 && state?.project?.sourceCli
          ? "strong"
          : "weak",
        contextSignals
      ),
    },
    signals: finalSignals,
    warnings: finalWarnings,
    blockers: finalBlockers,
    recommendation:
      level === "ready"
        ? "Safe to continue after normal repository inspection. This assessment is heuristic, not a guarantee."
        : level === "review_recommended"
          ? "Review the warnings and reconcile the live repository before editing."
          : "Inspect the source session or clarify and resolve the blockers before continuing.",
  };
}

export function formatHandoffReadiness(
  readiness: HandoffReadinessResult
): string {
  const lines = [
    `Handoff readiness: ${readiness.level.replace(/_/g, " ").toUpperCase()}`,
  ];
  if (readiness.signals.length > 0) {
    lines.push("", "Strong signals");
    lines.push(...readiness.signals.map((signal) => `✓ ${signal}`));
  }
  if (readiness.warnings.length > 0) {
    lines.push("", "Warnings");
    lines.push(...readiness.warnings.map((warning) => `! ${warning}`));
  }
  if (readiness.blockers.length > 0) {
    lines.push("", "Blockers");
    lines.push(...readiness.blockers.map((blocker) => `✗ ${blocker}`));
  }
  lines.push("", "Recommendation:", readiness.recommendation);
  return lines.join("\n");
}
