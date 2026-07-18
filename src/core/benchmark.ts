import fs from "node:fs/promises";
import path from "node:path";
import { HammaSession } from "./schema.js";

const BYTES_PER_ESTIMATED_TOKEN = 4;

export const EFFECTIVE_CONTINUATION_ARTIFACTS = [
  "handoff.md",
  "state.json",
  "tool_history.jsonl",
] as const;

export const ARCHIVE_ONLY_ARTIFACTS = [
  "session.json",
  "timeline.md",
  "commands.md",
  "redaction-report.md",
] as const;

export interface BenchmarkArtifact {
  name: string;
  present: boolean;
  bytes: number;
  estimatedTokens: number;
}

export interface BenchmarkSource {
  available: boolean;
  basis: "normalized_message_and_tool_content";
  messageCount?: number;
  messageCharacterCount?: number;
  messageBytes?: number;
  shellCommandCount?: number;
  toolCharacterCount?: number;
  toolBytes?: number;
  characterCount?: number;
  utf8Bytes?: number;
  estimatedTokens?: number;
}

export interface BenchmarkArtifactGroup {
  artifacts: BenchmarkArtifact[];
  totalBytes: number;
  estimatedTokens: number;
  missingArtifacts: string[];
}

export interface BenchmarkReductions {
  bytes?: number;
  bytesPercent?: number;
  estimatedTokens?: number;
  estimatedTokensPercent?: number;
  continuationLargerThanSource?: boolean;
}

export interface ContextEfficiencyBenchmark {
  schemaVersion: 1;
  taskId: string;
  source: BenchmarkSource;
  effectiveContinuation: BenchmarkArtifactGroup;
  archiveOnly: BenchmarkArtifactGroup;
  reductions: BenchmarkReductions;
  estimationMethod: {
    name: "utf8_bytes_divided_by_4";
    formula: "ceil(UTF-8 bytes / 4)";
    bytesPerEstimatedToken: 4;
    exactTokenizer: false;
    note: string;
  };
  warnings: string[];
}

export function estimateTokens(utf8Bytes: number): number {
  return Math.ceil(Math.max(0, utf8Bytes) / BYTES_PER_ESTIMATED_TOKEN);
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function percentageReduction(source: number, continuation: number): number | undefined {
  if (source === 0) return undefined;
  return Number((((source - continuation) / source) * 100).toFixed(2));
}

async function artifactMetric(
  taskPath: string,
  name: string
): Promise<BenchmarkArtifact> {
  try {
    const stats = await fs.stat(path.join(taskPath, name));
    if (!stats.isFile()) throw Object.assign(new Error("not a file"), { code: "ENOENT" });
    return {
      name,
      present: true,
      bytes: stats.size,
      estimatedTokens: estimateTokens(stats.size),
    };
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    return { name, present: false, bytes: 0, estimatedTokens: 0 };
  }
}

async function artifactGroup(
  taskPath: string,
  names: readonly string[]
): Promise<BenchmarkArtifactGroup> {
  const artifacts = await Promise.all(
    names.map((name) => artifactMetric(taskPath, name))
  );
  const totalBytes = artifacts.reduce((total, artifact) => total + artifact.bytes, 0);
  return {
    artifacts,
    totalBytes,
    estimatedTokens: estimateTokens(totalBytes),
    missingArtifacts: artifacts
      .filter((artifact) => !artifact.present)
      .map((artifact) => artifact.name),
  };
}

function measureSource(session: HammaSession): BenchmarkSource {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const commands = Array.isArray(session.shellCommands) ? session.shellCommands : [];
  const messageValues = messages.map((message) =>
    typeof message.content === "string" ? message.content : ""
  );
  const toolValues = commands.flatMap((command) => [
    typeof command.command === "string" ? command.command : "",
    typeof command.output === "string" ? command.output : "",
  ]);
  const messageCharacterCount = messageValues.reduce(
    (total, value) => total + countCharacters(value),
    0
  );
  const messageBytes = messageValues.reduce(
    (total, value) => total + Buffer.byteLength(value, "utf8"),
    0
  );
  const toolCharacterCount = toolValues.reduce(
    (total, value) => total + countCharacters(value),
    0
  );
  const toolBytes = toolValues.reduce(
    (total, value) => total + Buffer.byteLength(value, "utf8"),
    0
  );
  const utf8Bytes = messageBytes + toolBytes;

  return {
    available: true,
    basis: "normalized_message_and_tool_content",
    messageCount: messages.length,
    messageCharacterCount,
    messageBytes,
    shellCommandCount: commands.length,
    toolCharacterCount,
    toolBytes,
    characterCount: messageCharacterCount + toolCharacterCount,
    utf8Bytes,
    estimatedTokens: estimateTokens(utf8Bytes),
  };
}

async function readSource(taskPath: string): Promise<BenchmarkSource> {
  try {
    const session = JSON.parse(
      await fs.readFile(path.join(taskPath, "session.json"), "utf8")
    ) as HammaSession;
    if (!Array.isArray(session.messages) || !Array.isArray(session.shellCommands)) {
      throw new Error("session.json does not contain normalized messages and shell commands");
    }
    return measureSource(session);
  } catch (error: any) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError) &&
        !String(error.message).includes("does not contain normalized")) {
      throw error;
    }
    return {
      available: false,
      basis: "normalized_message_and_tool_content",
    };
  }
}

export async function benchmarkHandoff(
  taskPath: string,
  taskId = path.basename(taskPath)
): Promise<ContextEfficiencyBenchmark> {
  const [source, effectiveContinuation, archiveOnly] = await Promise.all([
    readSource(taskPath),
    artifactGroup(taskPath, EFFECTIVE_CONTINUATION_ARTIFACTS),
    artifactGroup(taskPath, ARCHIVE_ONLY_ARTIFACTS),
  ]);
  const warnings: string[] = [];
  if (!source.available) {
    warnings.push(
      "Source metrics are unavailable because a compatible normalized session.json is missing."
    );
  }
  if (effectiveContinuation.missingArtifacts.length > 0) {
    warnings.push(
      `Effective continuation artifacts are missing: ${effectiveContinuation.missingArtifacts.join(", ")}.`
    );
  }

  const reductions: BenchmarkReductions = {};
  if (source.available && source.utf8Bytes !== undefined &&
      source.estimatedTokens !== undefined) {
    reductions.bytes = source.utf8Bytes - effectiveContinuation.totalBytes;
    reductions.bytesPercent = percentageReduction(
      source.utf8Bytes,
      effectiveContinuation.totalBytes
    );
    reductions.estimatedTokens =
      source.estimatedTokens - effectiveContinuation.estimatedTokens;
    reductions.estimatedTokensPercent = percentageReduction(
      source.estimatedTokens,
      effectiveContinuation.estimatedTokens
    );
    reductions.continuationLargerThanSource =
      effectiveContinuation.totalBytes > source.utf8Bytes;
  }

  return {
    schemaVersion: 1,
    taskId,
    source,
    effectiveContinuation,
    archiveOnly,
    reductions,
    estimationMethod: {
      name: "utf8_bytes_divided_by_4",
      formula: "ceil(UTF-8 bytes / 4)",
      bytesPerEstimatedToken: BYTES_PER_ESTIMATED_TOKEN,
      exactTokenizer: false,
      note: "Deterministic cross-agent size estimate; not an exact provider-specific tokenizer count.",
    },
    warnings,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "unavailable" : `${value.toFixed(2)}%`;
}

function formatByteDifference(value: number): string {
  if (value === 0) return "no size difference";
  return `${formatBytes(Math.abs(value))} ${value > 0 ? "smaller" : "larger"}`;
}

function formatTokenDifference(value: number): string {
  if (value === 0) return "no estimated-token difference";
  return `~${Math.abs(value)} ${value > 0 ? "fewer" : "more"}`;
}

export function formatContextEfficiencyBenchmark(
  benchmark: ContextEfficiencyBenchmark
): string {
  const lines = ["Context efficiency", "", "Source session"];
  if (benchmark.source.available) {
    lines.push(
      `Messages: ${benchmark.source.messageCount}`,
      `Shell/tool commands: ${benchmark.source.shellCommandCount}`,
      `Characters: ${benchmark.source.characterCount}`,
      `Normalized content: ${formatBytes(benchmark.source.utf8Bytes ?? 0)}`,
      `Estimated tokens: ~${benchmark.source.estimatedTokens}`
    );
  } else {
    lines.push("Metrics: unavailable (compatible session.json not found)");
  }

  lines.push("", "Effective continuation context");
  for (const artifact of benchmark.effectiveContinuation.artifacts) {
    lines.push(
      `${artifact.name}: ${artifact.present ? formatBytes(artifact.bytes) : "missing"}`
    );
  }
  lines.push(
    `Total: ${formatBytes(benchmark.effectiveContinuation.totalBytes)}`,
    `Estimated tokens: ~${benchmark.effectiveContinuation.estimatedTokens}`,
    "",
    "Reduction"
  );
  if (benchmark.reductions.bytesPercent === undefined) {
    lines.push("Bytes: unavailable", "Estimated tokens: unavailable");
  } else {
    lines.push(
      `Bytes: ${formatPercent(benchmark.reductions.bytesPercent)} (${formatByteDifference(benchmark.reductions.bytes ?? 0)})`,
      `Estimated tokens: ${formatPercent(benchmark.reductions.estimatedTokensPercent)} (${formatTokenDifference(benchmark.reductions.estimatedTokens ?? 0)})`
    );
    if (benchmark.reductions.continuationLargerThanSource) {
      lines.push("The effective continuation context is larger than the normalized source content.");
    }
  }

  lines.push("", "Archive-only local artifacts");
  for (const artifact of benchmark.archiveOnly.artifacts) {
    lines.push(
      `${artifact.name}: ${artifact.present ? formatBytes(artifact.bytes) : "missing"}`
    );
  }
  lines.push(
    "",
    "Note:",
    "Source size is normalized message content plus shell command/output content.",
    "Archive-only artifacts are excluded from the effective continuation total.",
    benchmark.estimationMethod.note
  );
  if (benchmark.warnings.length > 0) {
    lines.push("", "Warnings");
    for (const warning of benchmark.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}
