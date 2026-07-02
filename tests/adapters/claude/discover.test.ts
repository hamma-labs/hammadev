import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverClaudeSessions } from "../../../src/adapters/claude/discover.js";

let claudeHome = "";
let expectedFiles: Record<string, string> = {};

async function writeFile(rel: string, contents: string, mtime: Date) {
  const full = path.join(claudeHome, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents);
  await fs.utimes(full, mtime, mtime);
  return full;
}

beforeAll(async () => {
  claudeHome = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-claude-"));

  expectedFiles.projectA = await writeFile(
    "projects/-home-ubuntu-projA/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl",
    JSON.stringify({
      type: "user",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cwd: "/home/ubuntu/projA",
      message: { role: "user", content: "hi" }
    }) + "\n",
    new Date("2026-06-01T10:00:00Z")
  );

  expectedFiles.projectB = await writeFile(
    "projects/-home-ubuntu-projB/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl",
    JSON.stringify({
      type: "mode",
      sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    }) +
      "\n" +
      JSON.stringify({
        type: "user",
        cwd: "/home/ubuntu/projB",
        message: { role: "user", content: "hey" }
      }) +
      "\n",
    new Date("2026-06-02T10:00:00Z")
  );

  // A non-jsonl file that must be ignored.
  await writeFile("projects/-home-ubuntu-projA/notes.txt", "not a session", new Date());

  // A stray README that must be ignored (not under projects/).
  await writeFile("README.md", "hi", new Date());
});

afterAll(async () => {
  if (claudeHome) await fs.rm(claudeHome, { recursive: true, force: true });
});

describe("discoverClaudeSessions", () => {
  it("finds both .jsonl session files under projects/", async () => {
    const found = await discoverClaudeSessions([claudeHome]);
    const paths = found.map((f) => f.path).sort();
    expect(paths).toEqual([expectedFiles.projectA, expectedFiles.projectB].sort());
  });

  it("sorts results newest-first by mtime", async () => {
    const found = await discoverClaudeSessions([claudeHome]);
    expect(found[0].path).toBe(expectedFiles.projectB);
    expect(found[1].path).toBe(expectedFiles.projectA);
  });

  it("captures size, updated timestamp, sessionId, and projectPath hint", async () => {
    const found = await discoverClaudeSessions([claudeHome]);
    const b = found.find((f) => f.path === expectedFiles.projectB)!;
    expect(b.sizeBytes).toBeGreaterThan(0);
    expect(b.lastUpdatedAt).toBe("2026-06-02T10:00:00.000Z");
    expect(b.sessionId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(b.projectPathHint).toBe("/home/ubuntu/projB");
    expect(b.claudeHome).toBe(claudeHome);
    expect(b.sourceCli).toBe("claude");
  });

  it("ignores non-.jsonl files and files outside the known subdirs", async () => {
    const found = await discoverClaudeSessions([claudeHome]);
    expect(found.some((f) => f.path.endsWith("notes.txt"))).toBe(false);
    expect(found.some((f) => f.path.endsWith("README.md"))).toBe(false);
  });

  it("returns an empty array when no candidate homes exist", async () => {
    const bogus = path.join(os.tmpdir(), "hamma-claude-missing-" + Date.now());
    const found = await discoverClaudeSessions([bogus]);
    expect(found).toEqual([]);
  });

  it("returns an empty array when the home exists but has no session files", async () => {
    const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-claude-empty-"));
    try {
      const found = await discoverClaudeSessions([emptyHome]);
      expect(found).toEqual([]);
    } finally {
      await fs.rm(emptyHome, { recursive: true, force: true });
    }
  });
});
