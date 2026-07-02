import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectClaudeShape } from "../../../src/adapters/claude/shape.js";

let tmpDir = "";
let fixturePath = "";

const secretContent = "SUPER_SECRET_USER_MESSAGE_DO_NOT_LEAK";
const secretOutput = "SECRET_TOOL_OUTPUT_ALSO_DO_NOT_LEAK";

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-claude-shape-"));
  fixturePath = path.join(tmpDir, "session.jsonl");

  const lines = [
    JSON.stringify({ type: "mode", mode: "normal", sessionId: "session-1" }),
    JSON.stringify({
      type: "permission-mode",
      permissionMode: "default",
      sessionId: "session-1"
    }),
    JSON.stringify({
      parentUuid: null,
      type: "user",
      uuid: "u1",
      timestamp: "2026-06-15T12:00:00Z",
      cwd: "/home/ubuntu/proj",
      sessionId: "session-1",
      message: { role: "user", content: secretContent }
    }),
    JSON.stringify({
      parentUuid: "u1",
      type: "assistant",
      uuid: "a1",
      timestamp: "2026-06-15T12:00:01Z",
      sessionId: "session-1",
      message: { role: "assistant", content: "assistant reply that also must not leak" }
    }),
    JSON.stringify({
      type: "tool-result",
      output: secretOutput,
      sessionId: "session-1"
    }),
    "{ this is malformed json",
    JSON.stringify({
      type: "user",
      uuid: "u2",
      cwd: "/home/ubuntu/proj",
      sessionId: "session-1",
      message: { role: "user", content: "another user message content" }
    }),
    "",
    JSON.stringify({
      type: "assistant",
      uuid: "a2",
      projectPath: "/home/ubuntu/proj",
      sessionId: "session-1",
      message: { role: "assistant", content: "second assistant reply" }
    })
  ];

  await fs.writeFile(fixturePath, lines.join("\n"));
});

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("inspectClaudeShape", () => {
  it("counts lines, parsed lines, and malformed lines", async () => {
    const r = await inspectClaudeShape(fixturePath);
    // 8 non-empty lines above (one empty is skipped), one malformed
    expect(r.totalLines).toBe(8);
    expect(r.parsedLines).toBe(7);
    expect(r.malformedLines).toBe(1);
    expect(r.sizeBytes).toBeGreaterThan(0);
    expect(r.path).toBe(fixturePath);
  });

  it("tallies top-level key frequencies", async () => {
    const r = await inspectClaudeShape(fixturePath);
    expect(r.topLevelKeyFrequency.type).toBe(7);
    expect(r.topLevelKeyFrequency.sessionId).toBe(7);
    expect(r.topLevelKeyFrequency.uuid).toBe(4);
    expect(r.topLevelKeyFrequency.message).toBe(4);
    expect(r.topLevelKeyFrequency.cwd).toBe(2);
    expect(r.topLevelKeyFrequency.projectPath).toBe(1);
  });

  it("tallies type field values", async () => {
    const r = await inspectClaudeShape(fixturePath);
    expect(r.typeCounts).toEqual({
      mode: 1,
      "permission-mode": 1,
      user: 2,
      assistant: 2,
      "tool-result": 1
    });
  });

  it("tallies role values (from message.role)", async () => {
    const r = await inspectClaudeShape(fixturePath);
    expect(r.roleCounts).toEqual({ user: 2, assistant: 2 });
  });

  it("captures per-type shape with merged types (e.g. parentUuid: string|null)", async () => {
    const r = await inspectClaudeShape(fixturePath);
    expect(r.shapeByType.user).toBeDefined();
    expect(r.shapeByType.assistant).toBeDefined();
    expect(r.shapeByType.mode).toEqual({
      type: "string",
      mode: "string",
      sessionId: "string"
    });

    const userShape = r.shapeByType.user;
    expect(userShape.type).toBe("string");
    expect(userShape.message).toBe("object");
    expect(userShape.sessionId).toBe("string");
    // parentUuid appears once as null (first user) and is absent on the second — merged type stays "null"
    expect(userShape.parentUuid).toBe("null");
  });

  it("detects cwd and projectPath values, sorted and deduped", async () => {
    const r = await inspectClaudeShape(fixturePath);
    expect(r.cwdValues).toEqual(["/home/ubuntu/proj"]);
    expect(r.projectPathValues).toEqual(["/home/ubuntu/proj"]);
  });

  it("does not leak raw message content or tool output anywhere in the report", async () => {
    const r = await inspectClaudeShape(fixturePath);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(secretContent);
    expect(serialized).not.toContain(secretOutput);
    expect(serialized).not.toContain("another user message content");
    expect(serialized).not.toContain("assistant reply");
  });
});
