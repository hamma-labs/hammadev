import path from "node:path";
import { ClaudeAdapter } from "./adapters/claude/index.js";
import { CodexAdapter } from "./adapters/codex/index.js";
import { GrokAdapter } from "./adapters/grok/index.js";
import {
  rankCandidates,
  SessionCandidate,
} from "./core/quality.js";
import { HammaSession, SourceCli } from "./core/schema.js";

export type ContinuationAgent = "codex" | "claude" | "grok";

export interface ContinuationDecision {
  schemaVersion: 1;
  projectPath: string;
  targetCli: ContinuationAgent;
  excludedSources: ContinuationAgent[];
  selected: SessionCandidate;
  candidates: SessionCandidate[];
  explanation: string[];
}

export interface ContinuationOptions {
  codexHome?: string;
  claudeHomes?: string[];
  grokHome?: string;
  includeTargetSource?: boolean;
}

const SUPPORTED_AGENTS = new Set<ContinuationAgent>([
  "codex",
  "claude",
  "grok",
]);

export function parseContinuationAgent(value: string): ContinuationAgent {
  const normalized = value.toLowerCase() as ContinuationAgent;
  if (!SUPPORTED_AGENTS.has(normalized)) {
    throw new Error(
      `Unsupported continuation target '${value}'. Use codex, claude, or grok.`
    );
  }
  return normalized;
}

export function chooseContinuationCandidate(
  candidates: SessionCandidate[],
  targetCli: ContinuationAgent,
  includeTargetSource = false
): Pick<ContinuationDecision, "selected" | "candidates" | "excludedSources" | "explanation"> {
  const excludedSources = includeTargetSource ? [] : [targetCli];
  const eligible = candidates.filter(
    (candidate) => includeTargetSource || candidate.sourceCli !== targetCli
  );
  const ranked = rankCandidates(eligible);
  const selected = ranked.find((candidate) => candidate.resumable);
  if (!selected) {
    const suffix = includeTargetSource
      ? ""
      : ` Sessions from the target agent '${targetCli}' were excluded to avoid selecting the active continuation session.`;
    throw new Error(`No resumable cross-agent session was found.${suffix}`);
  }

  const explanation = [
    `Selected the highest-ranked resumable ${selected.sourceCli} session across ${ranked.length} eligible candidate${ranked.length === 1 ? "" : "s"}.`,
    `Quality score ${selected.score} (${selected.confidence} confidence); signals: ${selected.signals.join(", ") || "none"}.`,
    includeTargetSource
      ? "Sessions from the target agent were included by request."
      : `Excluded ${targetCli} sessions to avoid a self-referential continuation.`,
    "Quality ranks before recency; recency only breaks equal-score ties.",
  ];

  return { selected, candidates: ranked, excludedSources, explanation };
}

export async function decideContinuation(
  projectPath: string,
  targetCli: ContinuationAgent,
  options: ContinuationOptions = {}
): Promise<ContinuationDecision> {
  const resolvedProject = path.resolve(projectPath);
  const [codex, claude, grok] = await Promise.all([
    CodexAdapter.listProject(resolvedProject, options.codexHome),
    ClaudeAdapter.listProject(resolvedProject, options.claudeHomes),
    GrokAdapter.listProject(resolvedProject, options.grokHome),
  ]);
  const choice = chooseContinuationCandidate(
    [...codex.candidates, ...claude.candidates, ...grok.candidates],
    targetCli,
    options.includeTargetSource
  );
  return {
    schemaVersion: 1,
    projectPath: resolvedProject,
    targetCli,
    ...choice,
  };
}

export async function loadContinuationSession(
  candidate: SessionCandidate,
  grokHome?: string
): Promise<HammaSession> {
  const source = candidate.sourceCli as SourceCli;
  if (source === "codex") return CodexAdapter.inspect(candidate.path);
  if (source === "claude") return ClaudeAdapter.inspect(candidate.path);
  if (source === "grok") return GrokAdapter.inspect(candidate.path, grokHome);
  throw new Error(`Unsupported continuation source '${source}'.`);
}
