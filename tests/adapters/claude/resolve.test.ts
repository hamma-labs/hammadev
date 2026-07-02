import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveClaudeTarget } from "../../../src/adapters/claude/resolve.js";

let claudeHome = "";
let idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let idB = "aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let idC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let fileA = "";
let fileB = "";
let fileC = "";

async function write(rel: string, contents: string, mtime: Date) {
  const full = path.join(claudeHome, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents);
  await fs.utimes(full, mtime, mtime);
  return full;
}

beforeAll(async () => {
  claudeHome = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-claude-resolve-"));

  fileA = await write(
    `projects/-proj-a/${idA}.jsonl`,
    JSON.stringify({ type: "mode", sessionId: idA }) + "\n",
    new Date("2026-06-01T00:00:00Z")
  );
  fileB = await write(
    `projects/-proj-b/${idB}.jsonl`,
    JSON.stringify({ type: "mode", sessionId: idB }) + "\n",
    new Date("2026-06-02T00:00:00Z")
  );
  fileC = await write(
    `projects/-proj-c/${idC}.jsonl`,
    JSON.stringify({ type: "mode", sessionId: idC }) + "\n",
    new Date("2026-06-03T00:00:00Z")
  );
});

afterAll(async () => {
  if (claudeHome) await fs.rm(claudeHome, { recursive: true, force: true });
});

describe("resolveClaudeTarget", () => {
  it("claude:last returns the newest session by mtime", async () => {
    const out = await resolveClaudeTarget("claude:last", { claudeHomes: [claudeHome] });
    expect(out).toBe(fileC);
  });

  it("claude:<exact-id> resolves the exact match", async () => {
    const out = await resolveClaudeTarget(`claude:${idA}`, { claudeHomes: [claudeHome] });
    expect(out).toBe(fileA);
  });

  it("claude:<unique-prefix> resolves when only one id matches", async () => {
    const out = await resolveClaudeTarget("claude:cccc", { claudeHomes: [claudeHome] });
    expect(out).toBe(fileC);
  });

  it("throws a clear ambiguity error listing all matches", async () => {
    await expect(
      resolveClaudeTarget("claude:aaaaaaaa", { claudeHomes: [claudeHome] })
    ).rejects.toThrow(/Ambiguous Claude sessionId prefix 'aaaaaaaa'/);

    try {
      await resolveClaudeTarget("claude:aaaaaaaa", { claudeHomes: [claudeHome] });
    } catch (err: any) {
      expect(err.message).toContain(idA);
      expect(err.message).toContain(idB);
    }
  });

  it("throws not-found for an unknown id", async () => {
    await expect(
      resolveClaudeTarget("claude:zzzzzzzz", { claudeHomes: [claudeHome] })
    ).rejects.toThrow(/No Claude session found with sessionId matching 'zzzzzzzz'/);
  });

  it("throws a clear error when no Claude sessions exist at all", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-claude-empty-"));
    try {
      await expect(
        resolveClaudeTarget("claude:last", { claudeHomes: [empty] })
      ).rejects.toThrow(/No Claude Code session files found/);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  it("rejects a non-claude: target", async () => {
    await expect(resolveClaudeTarget("codex:last")).rejects.toThrow(
      /Invalid Claude target/
    );
  });
});
