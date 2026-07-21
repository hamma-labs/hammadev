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
  provenance: "sanitized-real-session";
  session: HammaSession;
  expected: {
    outcome: HammaHandoffOutcome;
    nextActionContains: string | null;
    recall: SemanticEvaluationRecallExpectation[];
  };
}

export interface SemanticEvaluationDataset {
  schemaVersion: 1;
  cases: SemanticEvaluationCase[];
}

export interface SemanticEvaluationReport {
  schemaVersion: 1;
  cases: number;
  recallQueries: number;
  metrics: {
    taskStateAccuracy: number;
    nextActionAccuracy: number;
    recallUsefulness: number;
  };
  failures: Array<{
    caseId: string;
    metric: "taskStateAccuracy" | "nextActionAccuracy" | "recallUsefulness";
    expected: string;
    actual: string;
  }>;
}

function validateDataset(value: unknown): SemanticEvaluationDataset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Semantic evaluation dataset must be a JSON object.");
  }
  const dataset = value as Partial<SemanticEvaluationDataset>;
  if (dataset.schemaVersion !== 1 || !Array.isArray(dataset.cases) || dataset.cases.length === 0) {
    throw new Error("Semantic evaluation dataset must contain schemaVersion 1 and at least one case.");
  }
  for (const item of dataset.cases) {
    if (
      !item.id ||
      item.provenance !== "sanitized-real-session" ||
      !item.session ||
      !item.expected ||
      !Array.isArray(item.expected.recall)
    ) {
      throw new Error("Semantic evaluation case is missing required labeled fields.");
    }
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
  let outcomeMatches = 0;
  let nextActionMatches = 0;
  let recallMatches = 0;
  let recallQueries = 0;
  const failures: SemanticEvaluationReport["failures"] = [];

  for (const item of dataset.cases) {
    const state = extractTaskState(item.session, {
      targetCli: "memory",
      repoState: { warnings: [] },
    });
    if (state.outcome === item.expected.outcome) {
      outcomeMatches += 1;
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

    const candidates = recallCandidates(item.session, state);
    for (const expectation of item.expected.recall) {
      recallQueries += 1;
      const ranked = candidates
        .map((content, index) => ({
          content,
          score: scoreMemoryRecall(expectation.query, content, [], index / 10_000),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3);
      const recalled = ranked.some((candidate) =>
        candidate.content.toLowerCase().includes(expectation.answerContains.toLowerCase())
      );
      if (recalled) {
        recallMatches += 1;
      } else {
        failures.push({
          caseId: item.id,
          metric: "recallUsefulness",
          expected: expectation.answerContains,
          actual: ranked.map((candidate) => candidate.content.slice(0, 120)).join(" | ") || "no result",
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    cases: dataset.cases.length,
    recallQueries,
    metrics: {
      taskStateAccuracy: outcomeMatches / dataset.cases.length,
      nextActionAccuracy: nextActionMatches / dataset.cases.length,
      recallUsefulness: recallQueries === 0 ? 1 : recallMatches / recallQueries,
    },
    failures,
  };
}

export async function evaluateSemanticDatasetFile(target: string): Promise<SemanticEvaluationReport> {
  return evaluateSemanticDataset(validateDataset(JSON.parse(await fs.readFile(target, "utf8"))));
}
