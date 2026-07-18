import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureGitRepositorySnapshot,
  checkRepositoryDrift,
  compareRepositorySnapshots,
  repositorySnapshotFingerprint,
} from "../../src/core/git-snapshot.js";

let repo = "";

function git(args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Hamma Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Hamma Test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
  }).trim();
}

async function write(relative: string, content: string): Promise<void> {
  const target = path.join(repo, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function commit(message: string): Promise<void> {
  git(["add", "."]);
  git(["commit", "-m", message]);
}

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-git-snapshot-"));
  git(["init", "-b", "main"]);
  await write("src/core.ts", "export const value = 1;\n");
  await write("README.md", "synthetic repository\n");
  await commit("initial");
});

afterEach(async () => {
  if (repo) await fs.rm(repo, { recursive: true, force: true });
});

describe("Git repository snapshot and drift comparison", () => {
  it("reports no drift for the same clean HEAD and branch", () => {
    const recorded = captureGitRepositorySnapshot(repo, ["src/core.ts"]);
    const current = captureGitRepositorySnapshot(repo, ["src/core.ts"]);
    const result = compareRepositorySnapshots(recorded, current);

    expect(result.detected).toBe(false);
    expect(result.categories).toEqual(["none"]);
    expect(recorded.head).toBe(git(["rev-parse", "HEAD"]));
    expect(recorded.branch).toBe("main");
    expect(recorded.fingerprint).toBe(repositorySnapshotFingerprint(recorded));
  });

  it("classifies a differing unstaged working-tree file", async () => {
    const recorded = captureGitRepositorySnapshot(repo);
    await write("README.md", "working tree differs\n");
    const result = checkRepositoryDrift(repo, recorded);

    expect(result.categories).toContain("working_tree_changed");
    expect(result.differences.changedFiles).toEqual(["README.md"]);
    expect(result.categories).not.toContain("head_changed");
  });

  it("classifies a differing HEAD commit", async () => {
    const recorded = captureGitRepositorySnapshot(repo);
    await write("new-file.ts", "export {};\n");
    await commit("move head");
    const result = checkRepositoryDrift(repo, recorded);

    expect(result.categories).toContain("head_changed");
    expect(result.differences.head?.recorded).toBe(recorded.head);
    expect(result.differences.head?.current).not.toBe(recorded.head);
  });

  it("classifies a branch difference without requiring a new commit", () => {
    const recorded = captureGitRepositorySnapshot(repo);
    git(["switch", "-c", "feature/readiness"]);
    const result = checkRepositoryDrift(repo, recorded);

    expect(result.categories).toContain("branch_changed");
    expect(result.categories).not.toContain("head_changed");
    expect(result.differences.branch).toMatchObject({
      recorded: "main",
      current: "feature/readiness",
    });
  });

  it("reports untracked entries that appear only in the current snapshot", async () => {
    const recorded = captureGitRepositorySnapshot(repo);
    await write("notes/new.txt", "untracked\n");
    const result = checkRepositoryDrift(repo, recorded);

    expect(result.categories).toContain("working_tree_changed");
    expect(result.differences.untrackedFilesAppeared).toEqual(["notes/new.txt"]);
    expect(result.signals.join(" ")).toContain("only in the current snapshot");
  });

  it("detects a different digest for a handoff-referenced file", async () => {
    const recorded = captureGitRepositorySnapshot(repo, ["src/core.ts"]);
    await write("src/core.ts", "export const value = 2;\n");
    const result = checkRepositoryDrift(repo, recorded);

    expect(result.categories).toContain("relevant_files_changed");
    expect(result.differences.relevantFiles).toEqual(["src/core.ts"]);
  });

  it("treats an old handoff without snapshot fields as unavailable, not corrupt", () => {
    const current = captureGitRepositorySnapshot(repo);
    const result = compareRepositorySnapshots(undefined, current);

    expect(result.categories).toEqual(["repository_unavailable"]);
    expect(result.recordedSnapshotAvailable).toBe(false);
    expect(result.signals.join(" ")).toContain("predates");
  });

  it("classifies a non-Git current directory as repository unavailable", async () => {
    const recorded = captureGitRepositorySnapshot(repo);
    const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-not-git-"));
    try {
      const current = captureGitRepositorySnapshot(nonGit);
      const result = compareRepositorySnapshots(recorded, current);
      expect(current.available).toBe(false);
      expect(result.categories).toEqual(["repository_unavailable"]);
      expect(result.currentSnapshotAvailable).toBe(false);
    } finally {
      await fs.rm(nonGit, { recursive: true, force: true });
    }
  });

  it("records staged and unstaged file lists separately", async () => {
    await write("src/core.ts", "export const value = 2;\n");
    git(["add", "src/core.ts"]);
    await write("README.md", "unstaged\n");
    const snapshot = captureGitRepositorySnapshot(repo);

    expect(snapshot.stagedFiles).toEqual(["src/core.ts"]);
    expect(snapshot.unstagedFiles).toEqual(["README.md"]);
    expect(snapshot.changedFiles).toEqual(["README.md", "src/core.ts"]);
    expect(snapshot.changedFileDigests).toHaveLength(2);
    expect(snapshot.changedFileDigests.find((file) => file.path === "src/core.ts")?.indexHash).toBeTruthy();
  });

  it("detects further content differences when the same file was already dirty", async () => {
    await write("README.md", "dirty at handoff\n");
    const recorded = captureGitRepositorySnapshot(repo);
    await write("README.md", "different dirty content now\n");
    const result = checkRepositoryDrift(repo, recorded);

    expect(recorded.changedFiles).toEqual(["README.md"]);
    expect(result.current.changedFiles).toEqual(["README.md"]);
    expect(result.categories).toContain("working_tree_changed");
    expect(result.differences.changedFiles).toEqual(["README.md"]);
  });
});
