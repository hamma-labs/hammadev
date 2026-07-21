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

async function main(): Promise<void> {
  const report = await evaluateSemanticDatasetFile(DATASET);
  const minimums = {
    taskStateAccuracy: threshold("task-state", 0.95),
    nextActionAccuracy: threshold("next-action", 0.90),
    recallUsefulness: threshold("recall", 0.90),
  };
  process.stdout.write(`${JSON.stringify({ ...report, minimums }, null, 2)}\n`);
  const missed = Object.entries(minimums).filter(([metric, minimum]) =>
    report.metrics[metric as keyof typeof report.metrics] < minimum
  );
  if (missed.length > 0) {
    throw new Error(`Semantic quality gate failed: ${missed.map(([metric]) => metric).join(", ")}.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
