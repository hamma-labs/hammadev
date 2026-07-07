import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AsyncStructuredLogger } from "../../src/core/logger.js";

describe("AsyncStructuredLogger", () => {
  it("buffers structured records with trace and operation context", async () => {
    const stream = new PassThrough();
    let output = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => (output += chunk));

    const logger = new AsyncStructuredLogger({
      level: "info",
      operation: "handoff",
      traceId: "trace-test",
      stream
    });
    logger.info("operation.started", { target: "claude:last" });
    await logger.flush();

    expect(JSON.parse(output)).toMatchObject({
      level: "info",
      traceId: "trace-test",
      operation: "handoff",
      event: "operation.started",
      context: { target: "claude:last" }
    });
  });

  it("filters records below the configured verbosity", async () => {
    const stream = new PassThrough();
    let output = "";
    stream.on("data", (chunk) => (output += chunk.toString()));
    const logger = new AsyncStructuredLogger({ level: "error", stream });

    logger.info("ignored");
    await logger.flush();
    expect(output).toBe("");
  });
});
