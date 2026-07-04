import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaudeSessionRef } from "../../../src/adapters/claude/discover.js";
import { assessClaudeSession } from "../../../src/adapters/claude/quality.js";

let root = "";
let sessionPath = "";

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-quality-"));
  sessionPath = path.join(
    root,
    "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa.jsonl"
  );
  const records = [
    {
      type: "user",
      sessionId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      cwd: root,
      message: { role: "user", content: "Implement the login page." }
    },
    {
      type: "assistant",
      sessionId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      message: {
        role: "assistant",
        content: "Implemented the login page and verified the tests passed."
      }
    }
  ];
  await fs.writeFile(
    sessionPath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );
});

afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("assessClaudeSession", () => {
  it("does not treat ordinary login feature work as an authentication failure", async () => {
    const reference: ClaudeSessionRef = {
      sourceCli: "claude",
      path: sessionPath,
      sizeBytes: (await fs.stat(sessionPath)).size,
      lastUpdatedAt: "2026-07-04T00:00:00Z",
      sessionId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      projectPathHint: root,
      claudeHome: root
    };

    const candidate = await assessClaudeSession(reference);

    expect(candidate.resumable).toBe(true);
    expect(candidate.confidence).toBe("high");
    expect(candidate.signals).not.toContain("authentication-failure");
  });
});
