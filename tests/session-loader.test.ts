import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSession } from "../src/session-loader.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODEX_FIXTURE = path.join(
  HERE,
  "adapters",
  "codex",
  "fixtures",
  "rollout-2026-06-15T12-00-00-fixture-abc-123.jsonl"
);
const CLAUDE_FIXTURE = path.join(
  HERE,
  "adapters",
  "claude",
  "fixtures",
  "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa.jsonl"
);

let root = "";
let codexHome = "";
let claudeHome = "";
let directClaudePath = "";

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-session-loader-"));
  codexHome = path.join(root, "codex");
  claudeHome = path.join(root, "claude");

  const codexPath = path.join(
    codexHome,
    "sessions",
    "2026",
    "06",
    "15",
    path.basename(CODEX_FIXTURE)
  );
  directClaudePath = path.join(
    claudeHome,
    "projects",
    "-home-ubuntu-proj",
    path.basename(CLAUDE_FIXTURE)
  );

  await fs.mkdir(path.dirname(codexPath), { recursive: true });
  await fs.mkdir(path.dirname(directClaudePath), { recursive: true });
  await fs.copyFile(CODEX_FIXTURE, codexPath);
  await fs.copyFile(CLAUDE_FIXTURE, directClaudePath);
});

afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("loadSession", () => {
  it("loads a Codex target through the Codex adapter", async () => {
    const session = await loadSession("codex:last", { codexHome });

    expect(session.meta.sourceCli).toBe("codex");
    expect(session.meta.sourceSessionId).toBe("fixture-abc-123");
  });

  it("loads a Claude target through the Claude adapter", async () => {
    const session = await loadSession("claude:last", {
      claudeHomes: [claudeHome]
    });

    expect(session.meta.sourceCli).toBe("claude");
    expect(session.meta.sourceSessionId).toBe(
      "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa"
    );
  });

  it("loads an absolute UUID-named Claude session path", async () => {
    const session = await loadSession(directClaudePath);
    expect(session.meta.sourceCli).toBe("claude");
  });
});
