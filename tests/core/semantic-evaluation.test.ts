import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateSemanticDatasetFile } from "../../src/core/semantic-evaluation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATASET = path.join(HERE, "fixtures", "semantic-evaluation.json");

describe("semantic memory evaluation", () => {
  it("meets the labeled task-state, next-action, and recall thresholds", async () => {
    const report = await evaluateSemanticDatasetFile(DATASET);

    expect(report.cases).toBeGreaterThanOrEqual(6);
    expect(report.recallQueries).toBeGreaterThanOrEqual(6);
    expect(report.metrics.taskStateAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(report.metrics.nextActionAccuracy).toBeGreaterThanOrEqual(0.90);
    expect(report.metrics.recallUsefulness).toBeGreaterThanOrEqual(0.90);
    expect(report.failures).toEqual([]);
  });
});
