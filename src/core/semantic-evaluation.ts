import fs from "node:fs/promises";
import { HammaSession } from "./schema.js";
import { scoreMemoryRecall } from "./memory-v2.js";
import { extractTaskState, HammaHandoffOutcome } from "./state.js";

export interface SemanticEvaluationRecallExpectation {
  query: string;
  answerContains: string;
}

export interface SemanticEvaluationCase {
  id: string;
  provenance: "sanitized-real-session" | "synthetic-stress";
  dimensions: string[];
  session: HammaSession;
  expected: {
    outcome: HammaHandoffOutcome;
    nextActionContains: string | null;
    recall: SemanticEvaluationRecallExpectation[];
  };
}

export interface SemanticEvaluationDataset {
  schemaVersion: 2;
  corpusVersion: string;
  cases: SemanticEvaluationCase[];
}

export interface SemanticMetricBreakdown {
  cases: number;
  taskStateAccuracy: number;
  nextActionAccuracy: number;
}

export interface SemanticEvaluationReport {
  schemaVersion: 2;
  corpusVersion: string;
  cases: number;
  recallQueries: number;
  sourceCliCounts: Record<string, number>;
  provenanceCounts: Record<SemanticEvaluationCase["provenance"], number>;
  outcomeCounts: Record<HammaHandoffOutcome, number>;
  metrics: {
    taskStateAccuracy: number;
    nextActionAccuracy: number;
    recallUsefulness: number;
    recallMeanReciprocalRank: number;
    falseActionableRate: number;
    falseCompleteRate: number;
  };
  dimensions: Record<string, SemanticMetricBreakdown>;
  failures: Array<{
    caseId: string;
    metric:
      | "taskStateAccuracy"
      | "nextActionAccuracy"
      | "recallUsefulness";
    expected: string;
    actual: string;
  }>;
}

function validateDataset(value: unknown): SemanticEvaluationDataset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Semantic evaluation dataset must be a JSON object.");
  }
  const dataset = value as Partial<SemanticEvaluationDataset>;
  if (
    dataset.schemaVersion !== 2 ||
    typeof dataset.corpusVersion !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/.test(dataset.corpusVersion) ||
    !Array.isArray(dataset.cases) ||
    dataset.cases.length === 0
  ) {
    throw new Error(
      "Semantic evaluation dataset must contain schemaVersion 2, a dated corpusVersion, and at least one case."
    );
  }
  const ids = new Set<string>();
  for (const item of dataset.cases) {
    if (
      !item.id ||
      !["sanitized-real-session", "synthetic-stress"].includes(item.provenance) ||
      !Array.isArray(item.dimensions) ||
      item.dimensions.length === 0 ||
      item.dimensions.some((dimension) => !/^[a-z0-9-]+$/.test(dimension)) ||
      !item.session ||
      !item.expected ||
      !["completed", "actionable", "blocked", "ambiguous"].includes(item.expected.outcome) ||
      !(item.expected.nextActionContains === null ||
        (typeof item.expected.nextActionContains === "string" && item.expected.nextActionContains.length > 0)) ||
      !Array.isArray(item.expected.recall) ||
      item.expected.recall.some((expectation) =>
        typeof expectation.query !== "string" ||
        expectation.query.trim().length === 0 ||
        typeof expectation.answerContains !== "string" ||
        expectation.answerContains.trim().length === 0
      )
    ) {
      throw new Error("Semantic evaluation case is missing required labeled fields.");
    }
    if (ids.has(item.id)) {
      throw new Error(`Semantic evaluation case id is duplicated: ${item.id}`);
    }
    ids.add(item.id);
  }
  return dataset as SemanticEvaluationDataset;
}

function recallCandidates(session: HammaSession, state: ReturnType<typeof extractTaskState>): string[] {
  return [
    state.goal,
    state.nextAction,
    state.current.latestAssistantStatus,
    ...state.tasks.flatMap((task) => [task.title, task.summary]),
    ...session.messages.map((message) => message.content),
  ].filter((value): value is string => Boolean(value));
}

export function evaluateSemanticDataset(dataset: SemanticEvaluationDataset): SemanticEvaluationReport {
  let outcomeMatchCount = 0;
  let nextActionMatches = 0;
  let recallMatches = 0;
  let recallQueries = 0;
  let recallReciprocalRank = 0;
  let expectedNotActionable = 0;
  let falseActionable = 0;
  let expectedNotComplete = 0;
  let falseComplete = 0;
  const sourceCliCounts: Record<string, number> = {};
  const provenanceCounts: Record<SemanticEvaluationCase["provenance"], number> = {
    "sanitized-real-session": 0,
    "synthetic-stress": 0,
  };
  const outcomeCounts: Record<HammaHandoffOutcome, number> = {
    completed: 0,
    actionable: 0,
    blocked: 0,
    ambiguous: 0,
  };
  const dimensionCounters = new Map<string, {
    cases: number;
    taskStateMatches: number;
    nextActionMatches: number;
  }>();
  const failures: SemanticEvaluationReport["failures"] = [];

  for (const item of dataset.cases) {
    sourceCliCounts[item.session.meta.sourceCli] =
      (sourceCliCounts[item.session.meta.sourceCli] ?? 0) + 1;
    provenanceCounts[item.provenance] += 1;
    outcomeCounts[item.expected.outcome] += 1;
    const state = extractTaskState(item.session, {
      targetCli: "memory",
      repoState: { warnings: [] },
    });
    const outcomeMatches = state.outcome === item.expected.outcome;
    if (outcomeMatches) {
      outcomeMatchCount += 1;
    } else {
      failures.push({
        caseId: item.id,
        metric: "taskStateAccuracy",
        expected: item.expected.outcome,
        actual: state.outcome,
      });
    }

    const expectedNext = item.expected.nextActionContains;
    const nextMatches = expectedNext === null
      ? state.nextAction === undefined
      : Boolean(state.nextAction?.toLowerCase().includes(expectedNext.toLowerCase()));
    if (nextMatches) {
      nextActionMatches += 1;
    } else {
      failures.push({
        caseId: item.id,
        metric: "nextActionAccuracy",
        expected: expectedNext ?? "no next action",
        actual: state.nextAction ?? "no next action",
      });
    }

    if (item.expected.outcome !== "actionable") {
      expectedNotActionable += 1;
      if (state.outcome === "actionable") falseActionable += 1;
    }
    if (item.expected.outcome !== "completed") {
      expectedNotComplete += 1;
      if (state.outcome === "completed") falseComplete += 1;
    }
    for (const dimension of new Set(item.dimensions)) {
      const counter = dimensionCounters.get(dimension) ?? {
        cases: 0,
        taskStateMatches: 0,
        nextActionMatches: 0,
      };
      counter.cases += 1;
      if (outcomeMatches) counter.taskStateMatches += 1;
      if (nextMatches) counter.nextActionMatches += 1;
      dimensionCounters.set(dimension, counter);
    }

    const candidates = recallCandidates(item.session, state);
    for (const expectation of item.expected.recall) {
      recallQueries += 1;
      const ranked = candidates
        .map((content, index) => ({
          content,
          score: scoreMemoryRecall(expectation.query, content, [], index / 10_000),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);
      const matchingIndex = ranked.findIndex((candidate) =>
        candidate.content.toLowerCase().includes(expectation.answerContains.toLowerCase())
      );
      const recalled = matchingIndex >= 0 && matchingIndex < 3;
      if (recalled) {
        recallMatches += 1;
      } else {
        failures.push({
          caseId: item.id,
          metric: "recallUsefulness",
          expected: expectation.answerContains,
          actual: ranked.slice(0, 3).map((candidate) => candidate.content.slice(0, 120)).join(" | ") || "no result",
        });
      }
      if (matchingIndex >= 0) recallReciprocalRank += 1 / (matchingIndex + 1);
    }
  }

  const dimensions = Object.fromEntries(
    [...dimensionCounters.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([dimension, counter]) => [dimension, {
        cases: counter.cases,
        taskStateAccuracy: counter.taskStateMatches / counter.cases,
        nextActionAccuracy: counter.nextActionMatches / counter.cases,
      }])
  );

  return {
    schemaVersion: 2,
    corpusVersion: dataset.corpusVersion,
    cases: dataset.cases.length,
    recallQueries,
    sourceCliCounts,
    provenanceCounts,
    outcomeCounts,
    metrics: {
      taskStateAccuracy: outcomeMatchCount / dataset.cases.length,
      nextActionAccuracy: nextActionMatches / dataset.cases.length,
      recallUsefulness: recallQueries === 0 ? 1 : recallMatches / recallQueries,
      recallMeanReciprocalRank:
        recallQueries === 0 ? 1 : recallReciprocalRank / recallQueries,
      falseActionableRate:
        expectedNotActionable === 0 ? 0 : falseActionable / expectedNotActionable,
      falseCompleteRate:
        expectedNotComplete === 0 ? 0 : falseComplete / expectedNotComplete,
    },
    dimensions,
    failures,
  };
}

export async function evaluateSemanticDatasetFile(target: string): Promise<SemanticEvaluationReport> {
  return evaluateSemanticDataset(validateDataset(JSON.parse(await fs.readFile(target, "utf8"))));
}
