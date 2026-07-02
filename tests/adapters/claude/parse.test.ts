import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseClaudeSession } from "../../../src/adapters/claude/parse.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
  HERE,
  "fixtures",
  "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa.jsonl"
);

describe("parseClaudeSession — v0.1 conservative parser", () => {
  it("only surfaces visible user and assistant messages", async () => {
    const s = await parseClaudeSession(FIXTURE);
    const roles = s.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("extracts string content and text-block content", async () => {
    const s = await parseClaudeSession(FIXTURE);
    expect(s.messages[0].content.startsWith("hi there")).toBe(true);
    expect(s.messages[1].content).toBe("Hello! How can I help?");
    expect(s.messages[2].content).toBe("another user message via text block");
    expect(s.messages[3].content).toBe("Done. All good.");
  });

  it("redacts secret-like text in message content", async () => {
    const s = await parseClaudeSession(FIXTURE);
    const first = s.messages[0].content;
    expect(first).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(first).toContain("[REDACTED_SECRET]");
    expect(s.security.redactionCount).toBeGreaterThan(0);
    expect(s.security.redacted).toBe(true);
  });

  it("ignores system / permission-mode / file-history-snapshot / ai-title / last-prompt / attachment / mode records", async () => {
    const s = await parseClaudeSession(FIXTURE);
    const blob = JSON.stringify(s);
    expect(blob).not.toContain("SYSTEM_PROMPT_DO_NOT_LEAK");
    expect(blob).not.toContain("Do not surface this title");
    expect(blob).not.toContain("internal cache");
    expect(blob).not.toContain("agent_listing_delta");
    expect(blob).not.toContain("permission-mode");
  });

  it("skips assistant thinking and tool_use blocks, and user tool_result blocks", async () => {
    const s = await parseClaudeSession(FIXTURE);
    const blob = JSON.stringify(s);
    expect(blob).not.toContain("INTERNAL_THOUGHT_MUST_NOT_LEAK");
    expect(blob).not.toContain("TOOL_RESULT_MUST_NOT_LEAK");
    expect(blob).not.toContain("ls -la");
  });

  it("skips messages whose text is empty/whitespace", async () => {
    const s = await parseClaudeSession(FIXTURE);
    // The final user record has content "   " (whitespace) and must not appear.
    expect(s.messages).toHaveLength(4);
  });

  it("records a parser warning for a malformed line but keeps parsing", async () => {
    const s = await parseClaudeSession(FIXTURE);
    expect(s.parserWarnings.length).toBeGreaterThanOrEqual(1);
    expect(s.parserWarnings[0]).toMatch(/malformed|non-object/i);
    // Parsing continued — messages after the malformed line are still empty because
    // the only later record is whitespace-only, but the 4 preceding messages are all present.
    expect(s.messages).toHaveLength(4);
  });

  it("detects projectPath from cwd and startedAt from earliest timestamp", async () => {
    const s = await parseClaudeSession(FIXTURE);
    expect(s.meta.projectPath).toBe("/home/ubuntu/proj");
    expect(s.meta.startedAt).toBe("2026-06-15T12:00:00Z");
    expect(s.meta.sourceCli).toBe("claude");
    expect(s.meta.sourceSessionId).toBe("aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa");
  });
});
