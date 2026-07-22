import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateSemanticDatasetFile } from "../../src/core/semantic-evaluation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATASET = path.join(HERE, "fixtures", "semantic-evaluation.json");

describe("semantic memory evaluation", () => {
  it("meets the labeled task-state, next-action, and recall thresholds", async () => {
    const report = await evaluateSemanticDatasetFile(DATASET);

    expect(report.schemaVersion).toBe(2);
    expect(report.cases).toBeGreaterThanOrEqual(18);
    expect(report.recallQueries).toBeGreaterThanOrEqual(18);
    expect(report.sourceCliCounts).toMatchObject({ claude: 6, codex: 6, grok: 6 });
    expect(report.provenanceCounts).toEqual({
      "sanitized-real-session": 6,
      "synthetic-stress": 12,
    });
    expect(report.outcomeCounts.completed).toBeGreaterThanOrEqual(6);
    expect(report.outcomeCounts.actionable).toBeGreaterThanOrEqual(4);
    expect(report.outcomeCounts.blocked).toBeGreaterThanOrEqual(3);
    expect(report.outcomeCounts.ambiguous).toBeGreaterThanOrEqual(2);
    expect(report.metrics.taskStateAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(report.metrics.nextActionAccuracy).toBeGreaterThanOrEqual(0.90);
    expect(report.metrics.recallUsefulness).toBeGreaterThanOrEqual(0.90);
    expect(report.metrics.recallMeanReciprocalRank).toBeGreaterThanOrEqual(0.80);
    expect(report.metrics.falseActionableRate).toBeLessThanOrEqual(0.05);
    expect(report.metrics.falseCompleteRate).toBeLessThanOrEqual(0.05);
    expect(report.dimensions["context-injection"].cases).toBeGreaterThanOrEqual(3);
    expect(report.dimensions.multilingual.cases).toBeGreaterThanOrEqual(3);
    expect(report.dimensions.interrupted.cases).toBeGreaterThanOrEqual(2);
    expect(report.dimensions.adversarial.cases).toBeGreaterThanOrEqual(2);
    expect(report.failures).toEqual([]);
  });
});
