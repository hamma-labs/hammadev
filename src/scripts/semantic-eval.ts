import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSemanticDatasetFile } from "../core/semantic-evaluation.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATASET = path.join(ROOT, "tests", "core", "fixtures", "semantic-evaluation.json");

function threshold(name: string, fallback: number): number {
  const flag = `--min-${name}`;
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${flag} must be a number from 0 to 1.`);
  }
  return parsed;
}

function countThreshold(name: string, fallback: number): number {
  const flag = `--min-${name}`;
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const report = await evaluateSemanticDatasetFile(DATASET);
  const minimums = {
    cases: countThreshold("cases", 18),
    taskStateAccuracy: threshold("task-state", 0.95),
    nextActionAccuracy: threshold("next-action", 0.90),
    recallUsefulness: threshold("recall", 0.90),
    recallMeanReciprocalRank: threshold("recall-mrr", 0.80),
  };
  const maximums = {
    falseActionableRate: threshold("false-actionable", 0.05),
    falseCompleteRate: threshold("false-complete", 0.05),
  };
  const corpusMinimums = {
    sanitizedRealSessionCases: 6,
    syntheticStressCases: 12,
  };
  process.stdout.write(`${JSON.stringify({ ...report, minimums, maximums, corpusMinimums }, null, 2)}\n`);
  const missed = [
    ...(report.cases < minimums.cases ? ["cases"] : []),
    ...(report.provenanceCounts["sanitized-real-session"] < corpusMinimums.sanitizedRealSessionCases
      ? ["sanitizedRealSessionCases"]
      : []),
    ...(report.provenanceCounts["synthetic-stress"] < corpusMinimums.syntheticStressCases
      ? ["syntheticStressCases"]
      : []),
    ...Object.entries(minimums)
      .filter(([metric]) => metric !== "cases")
      .filter(([metric, minimum]) =>
        report.metrics[metric as keyof typeof report.metrics] < minimum
      )
      .map(([metric]) => metric),
    ...Object.entries(maximums)
      .filter(([metric, maximum]) =>
        report.metrics[metric as keyof typeof report.metrics] > maximum
      )
      .map(([metric]) => metric),
  ];
  if (missed.length > 0) {
    throw new Error(`Semantic quality gate failed: ${missed.join(", ")}.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
