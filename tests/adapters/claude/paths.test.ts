import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  candidateClaudeHomes,
  claudeProjectsGlobs,
  defaultClaudeHome,
} from "../../../src/adapters/claude/paths.js";

const previousClaudeHome = process.env.CLAUDE_HOME;

afterEach(() => {
  if (previousClaudeHome === undefined) delete process.env.CLAUDE_HOME;
  else process.env.CLAUDE_HOME = previousClaudeHome;
});

describe("Claude home paths", () => {
  it("uses CLAUDE_HOME as the only explicit discovery root", () => {
    const explicitHome = path.resolve("fixture-claude-home");
    process.env.CLAUDE_HOME = explicitHome;

    expect(defaultClaudeHome()).toBe(explicitHome);
    expect(candidateClaudeHomes()).toEqual([explicitHome]);
  });

  it("uses separator-neutral globs relative to the Claude home", () => {
    expect(claudeProjectsGlobs()).toEqual([
      "projects/**/*.jsonl",
      "sessions/**/*.jsonl",
      "history/**/*.jsonl",
    ]);
  });
});
