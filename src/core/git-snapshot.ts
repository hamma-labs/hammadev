import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const GIT_SNAPSHOT_VERSION = 1 as const;

export interface GitRelevantFileSnapshot {
  path: string;
  contentHash?: string;
  indexHash?: string;
  missing?: boolean;
}

export interface GitRepositorySnapshot {
  version: typeof GIT_SNAPSHOT_VERSION;
  available: boolean;
  head?: string;
  branch?: string;
  detachedHead: boolean;
  stagedFiles: string[];
  unstagedFiles: string[];
  untrackedFiles: string[];
  changedFiles: string[];
  changedFileDigests: GitRelevantFileSnapshot[];
  relevantFiles: GitRelevantFileSnapshot[];
  fingerprint?: string;
  warnings: string[];
}

export type RepositoryDriftCategory =
  | "none"
  | "working_tree_changed"
  | "head_changed"
  | "branch_changed"
  | "relevant_files_changed"
  | "repository_unavailable";

export interface RepositoryDriftResult {
  schemaVersion: 1;
  detected: boolean;
  categories: RepositoryDriftCategory[];
  recordedSnapshotAvailable: boolean;
  currentSnapshotAvailable: boolean;
  recorded: GitRepositorySnapshot | null;
  current: GitRepositorySnapshot;
  differences: {
    head?: { recorded?: string; current?: string };
    branch?: {
      recorded?: string;
      current?: string;
      recordedDetached: boolean;
      currentDetached: boolean;
    };
    changedFiles: string[];
    relevantFiles: string[];
    untrackedFilesAppeared: string[];
    untrackedFilesDisappeared: string[];
  };
  signals: string[];
  recommendation: string;
}

function git(
  projectPath: string,
  args: string[],
  allowFailure = false
): string | undefined {
  try {
    return execFileSync("git", ["-C", projectPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).trim();
  } catch (error) {
    if (allowFailure) return undefined;
    throw error;
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function nulList(value: string | undefined): string[] {
  if (!value) return [];
  return sortedUnique(
    value
      .split("\0")
      .map((item) => item.trim())
      .filter((item) => item && !isHammaArtifact(item))
  );
}

function isHammaArtifact(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized === ".hamma" || normalized.startsWith(".hamma/");
}

function normalizeRelevantPath(
  projectPath: string,
  filePath: string
): string | undefined {
  const relative = path.isAbsolute(filePath)
    ? path.relative(projectPath, filePath)
    : filePath;
  const normalized = path
    .normalize(relative)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (
    !normalized ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.isAbsolute(normalized) ||
    isHammaArtifact(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function fingerprintInput(snapshot: GitRepositorySnapshot): string {
  return JSON.stringify({
    version: snapshot.version,
    head: snapshot.head ?? null,
    branch: snapshot.branch ?? null,
    detachedHead: snapshot.detachedHead,
    stagedFiles: snapshot.stagedFiles,
    unstagedFiles: snapshot.unstagedFiles,
    untrackedFiles: snapshot.untrackedFiles,
    changedFileDigests: snapshot.changedFileDigests,
  });
}

export function repositorySnapshotFingerprint(
  snapshot: GitRepositorySnapshot
): string | undefined {
  if (!snapshot.available) return undefined;
  return createHash("sha256").update(fingerprintInput(snapshot)).digest("hex");
}

export function captureGitRepositorySnapshot(
  projectPath: string,
  relevantFiles: string[] = []
): GitRepositorySnapshot {
  const warnings: string[] = [];
  const inside = git(projectPath, ["rev-parse", "--is-inside-work-tree"], true);
  if (inside !== "true") {
    warnings.push("Git repository metadata is unavailable for this project.");
    return {
      version: GIT_SNAPSHOT_VERSION,
      available: false,
      detachedHead: false,
      stagedFiles: [],
      unstagedFiles: [],
      untrackedFiles: [],
      changedFiles: [],
      changedFileDigests: [],
      relevantFiles: [],
      warnings,
    };
  }

  const head = git(projectPath, ["rev-parse", "--verify", "HEAD"], true);
  const branch = git(
    projectPath,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    true
  );
  const detachedHead = Boolean(head && !branch);
  const stagedFiles = nulList(
    git(projectPath, ["diff", "--cached", "--name-only", "-z"], true)
  );
  const unstagedFiles = nulList(
    git(projectPath, ["diff", "--name-only", "-z"], true)
  );
  const untrackedFiles = nulList(
    git(projectPath, ["ls-files", "--others", "--exclude-standard", "-z"], true)
  );
  const changedFiles = sortedUnique([
    ...stagedFiles,
    ...unstagedFiles,
    ...untrackedFiles,
  ]);

  const stagedSet = new Set(stagedFiles);
  const changedFileDigests = changedFiles.map((file) => {
    const contentHash = git(projectPath, ["hash-object", "--", file], true);
    const indexHash = stagedSet.has(file)
      ? git(projectPath, ["rev-parse", `:${file}`], true)
      : undefined;
    return contentHash || indexHash
      ? { path: file, contentHash, indexHash }
      : { path: file, missing: true as const };
  });

  const normalizedRelevant = sortedUnique(
    relevantFiles
      .map((file) => normalizeRelevantPath(projectPath, file))
      .filter((file): file is string => Boolean(file))
  );
  const relevantSnapshots = normalizedRelevant.map((file) => {
    const contentHash = git(projectPath, ["hash-object", "--", file], true);
    return contentHash
      ? { path: file, contentHash }
      : { path: file, missing: true as const };
  });

  const snapshot: GitRepositorySnapshot = {
    version: GIT_SNAPSHOT_VERSION,
    available: true,
    head,
    branch,
    detachedHead,
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    changedFiles,
    changedFileDigests,
    relevantFiles: relevantSnapshots,
    warnings,
  };
  snapshot.fingerprint = repositorySnapshotFingerprint(snapshot);
  return snapshot;
}

function symmetricDifference(left: string[], right: string[]): string[] {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return sortedUnique([
    ...left.filter((value) => !rightSet.has(value)),
    ...right.filter((value) => !leftSet.has(value)),
  ]);
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function digestDifferences(
  left: GitRelevantFileSnapshot[] | undefined,
  right: GitRelevantFileSnapshot[] | undefined
): string[] {
  const leftMap = new Map((left ?? []).map((file) => [file.path, file]));
  const rightMap = new Map((right ?? []).map((file) => [file.path, file]));
  const paths = sortedUnique([...leftMap.keys(), ...rightMap.keys()]);
  return paths.filter((filePath) => {
    const before = leftMap.get(filePath);
    const after = rightMap.get(filePath);
    return (
      !before ||
      !after ||
      before.contentHash !== after.contentHash ||
      before.indexHash !== after.indexHash ||
      Boolean(before.missing) !== Boolean(after.missing)
    );
  });
}

export function compareRepositorySnapshots(
  recorded: GitRepositorySnapshot | undefined,
  current: GitRepositorySnapshot
): RepositoryDriftResult {
  const categories: RepositoryDriftCategory[] = [];
  const signals: string[] = [];
  const differences: RepositoryDriftResult["differences"] = {
    changedFiles: [],
    relevantFiles: [],
    untrackedFilesAppeared: [],
    untrackedFilesDisappeared: [],
  };

  if (!recorded?.available || !current.available) {
    categories.push("repository_unavailable");
    signals.push(
      !recorded
        ? "The handoff predates versioned repository snapshots."
        : !recorded.available
          ? "Repository metadata was unavailable when the handoff was created."
          : "Current repository metadata is unavailable."
    );
  } else {
    if (recorded.head !== current.head) {
      categories.push("head_changed");
      differences.head = { recorded: recorded.head, current: current.head };
      signals.push(
        `HEAD differs: ${shortSha(recorded.head)} → ${shortSha(current.head)}.`
      );
    }
    if (
      recorded.branch !== current.branch ||
      recorded.detachedHead !== current.detachedHead
    ) {
      categories.push("branch_changed");
      differences.branch = {
        recorded: recorded.branch,
        current: current.branch,
        recordedDetached: recorded.detachedHead,
        currentDetached: current.detachedHead,
      };
      signals.push(
        `Branch differs: ${branchLabel(recorded)} → ${branchLabel(current)}.`
      );
    }

    differences.changedFiles = sortedUnique([
      ...symmetricDifference(recorded.changedFiles, current.changedFiles),
      ...digestDifferences(
        recorded.changedFileDigests,
        current.changedFileDigests
      ),
    ]);
    differences.untrackedFilesAppeared = difference(
      current.untrackedFiles,
      recorded.untrackedFiles
    );
    differences.untrackedFilesDisappeared = difference(
      recorded.untrackedFiles,
      current.untrackedFiles
    );
    if (differences.changedFiles.length > 0) {
      categories.push("working_tree_changed");
      signals.push(
        `${differences.changedFiles.length} working-tree file ` +
          `entr${differences.changedFiles.length === 1 ? "y differs" : "ies differ"} ` +
          "between the recorded and current snapshots."
      );
    }
    if (differences.untrackedFilesAppeared.length > 0) {
      signals.push(
        `${differences.untrackedFilesAppeared.length} untracked file ` +
          `entr${differences.untrackedFilesAppeared.length === 1 ? "y appears" : "ies appear"} ` +
          "only in the current snapshot."
      );
    }

    differences.relevantFiles = digestDifferences(
      recorded.relevantFiles,
      current.relevantFiles
    );
    if (differences.relevantFiles.length > 0) {
      categories.push("relevant_files_changed");
      signals.push(
        `${differences.relevantFiles.length} handoff-referenced file digest${differences.relevantFiles.length === 1 ? " differs" : "s differ"}.`
      );
    }
  }

  if (categories.length === 0) categories.push("none");
  const detected = categories.some((category) => category !== "none");
  return {
    schemaVersion: 1,
    detected,
    categories,
    recordedSnapshotAvailable: Boolean(recorded?.available),
    currentSnapshotAvailable: current.available,
    recorded: recorded ?? null,
    current,
    differences,
    signals,
    recommendation: detected
      ? "Inspect the live repository before continuing. Current repository state takes precedence over the handoff."
      : "The recorded and current Git metadata match closely. Continue with normal repository verification.",
  };
}

function shortSha(value: string | undefined): string {
  return value ? value.slice(0, 12) : "unavailable";
}

function branchLabel(snapshot: GitRepositorySnapshot): string {
  if (snapshot.detachedHead) return "detached HEAD";
  return snapshot.branch ?? "unavailable";
}

export function checkRepositoryDrift(
  projectPath: string,
  recorded: GitRepositorySnapshot | undefined
): RepositoryDriftResult {
  const relevantFiles = recorded?.relevantFiles?.map((file) => file.path) ?? [];
  const current = captureGitRepositorySnapshot(projectPath, relevantFiles);
  return compareRepositorySnapshots(recorded, current);
}

export function formatRepositoryDrift(result: RepositoryDriftResult): string {
  const lines = [
    `Repository drift: ${result.detected ? "detected" : "none detected"}`,
  ];
  if (result.differences.head) {
    lines.push(
      "",
      "HEAD",
      `handoff: ${result.differences.head.recorded ?? "unavailable"}`,
      `current: ${result.differences.head.current ?? "unavailable"}`
    );
  }
  if (result.differences.branch) {
    lines.push(
      "",
      "Branch",
      `handoff: ${branchLabel(result.recorded!)}`,
      `current: ${branchLabel(result.current)}`
    );
  }
  if (result.differences.changedFiles.length > 0) {
    lines.push("", "Working-tree snapshot differences");
    lines.push(...result.differences.changedFiles);
  }
  if (result.differences.relevantFiles.length > 0) {
    lines.push("", "Relevant files with different digests");
    lines.push(...result.differences.relevantFiles);
  }
  if (result.signals.length > 0) {
    lines.push("", "Signals");
    lines.push(...result.signals.map((signal) => `- ${signal}`));
  }
  lines.push("", "Recommendation:", result.recommendation);
  return lines.join("\n");
}
