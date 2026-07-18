import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_ONLY_ARTIFACTS,
  benchmarkHandoff,
  EFFECTIVE_CONTINUATION_ARTIFACTS,
  estimateTokens,
  formatContextEfficiencyBenchmark,
} from "../../src/core/benchmark.js";
import { HammaSession } from "../../src/core/schema.js";

let taskPath = "";

function session(messageContent: string, output = "test output"): HammaSession {
  return {
    meta: {
      sourceCli: "claude",
      sourceSessionId: "synthetic-benchmark",
    },
    messages: [
      { role: "user", content: messageContent },
      { role: "assistant", content: "I will continue the implementation." },
    ],
    shellCommands: [
      { command: "pnpm test", output, exitCode: 0 },
    ],
    parserWarnings: [],
    security: { redacted: false, redactionCount: 0, warnings: [] },
  };
}

async function writePackage(
  source: HammaSession,
  sizes: { handoff?: number; state?: number; tools?: number } = {}
): Promise<void> {
  await fs.writeFile(
    path.join(taskPath, "session.json"),
    JSON.stringify(source, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(taskPath, "handoff.md"), "h".repeat(sizes.handoff ?? 40));
  await fs.writeFile(path.join(taskPath, "state.json"), "s".repeat(sizes.state ?? 20));
  await fs.writeFile(
    path.join(taskPath, "tool_history.jsonl"),
    "t".repeat(sizes.tools ?? 10)
  );
  await fs.writeFile(path.join(taskPath, "timeline.md"), "archive timeline");
  await fs.writeFile(path.join(taskPath, "commands.md"), "archive commands");
  await fs.writeFile(path.join(taskPath, "redaction-report.md"), "archive redactions");
}

beforeEach(async () => {
  taskPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-benchmark-"));
});

afterEach(async () => {
  if (taskPath) await fs.rm(taskPath, { recursive: true, force: true });
});

describe("context-efficiency benchmark", () => {
  it("measures a generated-style package from normalized session content", async () => {
    const source = session("Build the parser. 😀", "all 42 tests passed");
    await writePackage(source);

    const result = await benchmarkHandoff(taskPath, "benchmark-task");

    const sourceValues = [
      ...source.messages.map((message) => message.content),
      ...source.shellCommands.flatMap((command) => [command.command, command.output ?? ""]),
    ];
    expect(result.source).toMatchObject({
      available: true,
      messageCount: 2,
      shellCommandCount: 1,
      characterCount: sourceValues.reduce(
        (total, value) => total + Array.from(value).length,
        0
      ),
      utf8Bytes: sourceValues.reduce(
        (total, value) => total + Buffer.byteLength(value, "utf8"),
        0
      ),
    });
    expect(result.effectiveContinuation.artifacts.map(({ name }) => name)).toEqual(
      EFFECTIVE_CONTINUATION_ARTIFACTS
    );
    expect(result.effectiveContinuation.totalBytes).toBe(70);
    expect(result.estimationMethod.exactTokenizer).toBe(false);
  });

  it("reports honest positive reductions for a large source session", async () => {
    await writePackage(session("x".repeat(10_000), "y".repeat(2_000)), {
      handoff: 500,
      state: 300,
      tools: 200,
    });
    const result = await benchmarkHandoff(taskPath);

    expect(result.reductions.bytes).toBeGreaterThan(10_000);
    expect(result.reductions.bytesPercent).toBeGreaterThan(90);
    expect(result.reductions.continuationLargerThanSource).toBe(false);
  });

  it("does not hide negative reductions when continuation is larger than a small source", async () => {
    await writePackage(session("tiny", ""), {
      handoff: 1_000,
      state: 1_000,
      tools: 1_000,
    });
    const result = await benchmarkHandoff(taskPath);

    expect(result.reductions.bytes).toBeLessThan(0);
    expect(result.reductions.bytesPercent).toBeLessThan(0);
    expect(result.reductions.continuationLargerThanSource).toBe(true);
    expect(formatContextEfficiencyBenchmark(result)).toContain(
      "continuation context is larger"
    );
  });

  it("excludes every archive-only artifact from the effective total", async () => {
    await writePackage(session("z".repeat(1_000)));
    await fs.writeFile(path.join(taskPath, "timeline.md"), "x".repeat(50_000));
    const result = await benchmarkHandoff(taskPath);

    expect(result.archiveOnly.artifacts.map(({ name }) => name)).toEqual(
      ARCHIVE_ONLY_ARTIFACTS
    );
    expect(result.archiveOnly.totalBytes).toBeGreaterThan(50_000);
    expect(result.effectiveContinuation.totalBytes).toBe(70);
  });

  it("reports a missing optional archive artifact without changing effective context", async () => {
    await writePackage(session("source".repeat(100)));
    await fs.rm(path.join(taskPath, "timeline.md"));
    const result = await benchmarkHandoff(taskPath);

    expect(result.archiveOnly.missingArtifacts).toEqual(["timeline.md"]);
    expect(result.effectiveContinuation.missingArtifacts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("degrades gracefully for an old handoff without a normalized source archive", async () => {
    await fs.writeFile(path.join(taskPath, "handoff.md"), "old handoff");
    const result = await benchmarkHandoff(taskPath, "old-task");

    expect(result.source.available).toBe(false);
    expect(result.reductions).toEqual({});
    expect(result.effectiveContinuation.missingArtifacts).toEqual([
      "state.json",
      "tool_history.jsonl",
    ]);
    expect(result.warnings).toHaveLength(2);
  });

  it("treats an incompatible old session.json as unavailable", async () => {
    await fs.writeFile(path.join(taskPath, "session.json"), JSON.stringify({ transcript: [] }));
    await fs.writeFile(path.join(taskPath, "handoff.md"), "old handoff");
    const result = await benchmarkHandoff(taskPath);

    expect(result.source.available).toBe(false);
    expect(result.archiveOnly.artifacts[0]).toMatchObject({
      name: "session.json",
      present: true,
    });
  });

  it("handles effectively empty normalized content without inventing a percentage", async () => {
    await writePackage(session("", ""));
    const source = JSON.parse(await fs.readFile(path.join(taskPath, "session.json"), "utf8"));
    source.messages = [];
    source.shellCommands = [];
    await fs.writeFile(path.join(taskPath, "session.json"), JSON.stringify(source));
    const result = await benchmarkHandoff(taskPath);

    expect(result.source.utf8Bytes).toBe(0);
    expect(result.source.estimatedTokens).toBe(0);
    expect(result.reductions.bytes).toBe(-70);
    expect(result.reductions.bytesPercent).toBeUndefined();
    expect(result.reductions.continuationLargerThanSource).toBe(true);
  });

  it("uses deterministic token estimates and reduction math", async () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);

    await writePackage(session("a".repeat(381), ""), {
      handoff: 100,
      state: 100,
      tools: 100,
    });
    const first = await benchmarkHandoff(taskPath);
    const second = await benchmarkHandoff(taskPath);
    expect(second).toEqual(first);
    expect(first.reductions.bytesPercent).toBe(
      Number((
        ((first.source.utf8Bytes! - 300) / first.source.utf8Bytes!) * 100
      ).toFixed(2))
    );
  });
});
