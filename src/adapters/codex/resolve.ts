import fs from "node:fs/promises";
import path from "node:path";
import { discoverCodexSessions, CodexSessionRef } from "./discover.js";
import { parseCodexRollout } from "./rollout.js";
import {
  SessionCandidate,
  SessionRef,
  rankSessions,
} from "../../core/quality.js";
import { filterSessionsByProject } from "../../core/project-match.js";

const CODEX_PREFIX = "codex:";
const EPOCH = new Date(0).toISOString();

export interface ResolveCodexOptions {
  codexHome?: string;
  projectPath?: string;
}

function toSessionRef(session: CodexSessionRef): SessionRef {
  return {
    sourceCli: "codex",
    sessionId: session.conversationId,
    path: session.path,
    projectPathHint: session.projectPathHint,
    lastUpdatedAt: session.lastUpdatedAt ?? session.startedAt ?? EPOCH,
    sizeBytes: session.sizeBytes,
  };
}

async function rankCodexSessions(
  sessions: CodexSessionRef[]
): Promise<SessionCandidate[]> {
  return rankSessions(sessions.map(toSessionRef), (ref) =>
    parseCodexRollout(ref.path)
  );
}

export async function listCodexProjectCandidates(
  projectPath: string,
  codexHome?: string
): Promise<{ projectPath: string; candidates: SessionCandidate[] }> {
  const sessions = await discoverCodexSessions(codexHome);
  const { requestedProject, matches } = await filterSessionsByProject(
    sessions,
    projectPath
  );
  return {
    projectPath: requestedProject,
    candidates: await rankCodexSessions(matches),
  };
}

function candidateSummary(candidate: SessionCandidate): string {
  const id = candidate.sessionId ?? "unknown-conversation-id";
  const signals = candidate.signals.length > 0 ? candidate.signals.join(", ") : "none";
  const reasons = candidate.reasons.length > 0 ? candidate.reasons.join("; ") : "none";
  return `  - ${id} | updated ${candidate.lastUpdatedAt} | confidence ${candidate.confidence} | score ${candidate.score} | signals: ${signals} | reasons: ${reasons}`;
}

export async function resolveCodexTarget(
  target: string,
  options: ResolveCodexOptions = {}
): Promise<string> {
  if (target.startsWith(CODEX_PREFIX)) {
    const rest = target.slice(CODEX_PREFIX.length);
    if (!rest) {
      throw new Error(
        `Invalid Codex target '${target}'. Expected 'codex:last', 'codex:project', 'codex:<conversationId>', or a rollout file path.`
      );
    }

    const sessions = await discoverCodexSessions(options.codexHome);

    if (rest === "last") {
      const latest = sessions[0];
      if (!latest) throw new Error("No Codex sessions found.");
      return latest.path;
    }

    if (rest === "current" || rest === "previous") {
      if (!options.projectPath) {
        throw new Error(
          `Resolving 'codex:${rest}' requires a project path. Pass --project <path>.`
        );
      }

      const { requestedProject, matches } = await filterSessionsByProject(
        sessions,
        options.projectPath
      );

      if (matches.length === 0) {
        throw new Error(
          `No Codex session found for project '${requestedProject}'.`
        );
      }

      // `matches` preserves discovery order (newest-mtime first) = the session
      // being actively written.
      if (rest === "current") {
        return matches[0].path;
      }

      const withoutSelf = matches.slice(1);
      if (withoutSelf.length === 0) {
        throw new Error(
          `No previous Codex session found for project '${requestedProject}' (only the current session exists).`
        );
      }

      const candidates = await rankCodexSessions(withoutSelf);
      const resumablePaths = new Set(
        candidates.filter((candidate) => candidate.resumable).map((c) => c.path)
      );
      const selected = withoutSelf.find((s) => resumablePaths.has(s.path));
      if (!selected) {
        const details = candidates.slice(0, 10).map(candidateSummary).join("\n");
        throw new Error(
          `No resumable previous Codex session found for project '${requestedProject}'.\n` +
          `Candidate sessions:\n${details}\n` +
          `Select one explicitly with codex:<conversationId> if this assessment is incorrect.`
        );
      }

      return selected.path;
    }

    if (rest === "project") {
      if (!options.projectPath) {
        throw new Error(
          "Resolving 'codex:project' requires a project path. Pass --project <path>."
        );
      }

      const { requestedProject, matches } = await filterSessionsByProject(
        sessions,
        options.projectPath
      );

      if (matches.length === 0) {
        throw new Error(
          `No Codex session found for project '${requestedProject}'.`
        );
      }

      const candidates = await rankCodexSessions(matches);
      const selected = candidates.find((candidate) => candidate.resumable);
      if (!selected) {
        const details = candidates.slice(0, 10).map(candidateSummary).join("\n");
        throw new Error(
          `No resumable Codex session found for project '${requestedProject}'.\n` +
          `Candidate sessions:\n${details}\n` +
          `Select one explicitly with codex:<conversationId> if this assessment is incorrect.`
        );
      }

      return selected.path;
    }

    return resolveByConversationId(rest, sessions);
  }

  return resolveByFilePath(target);
}

function resolveByConversationId(
  id: string,
  sessions: CodexSessionRef[]
): string {
  const exact = sessions.find((s) => s.conversationId === id);
  if (exact) return exact.path;

  const prefixMatches = sessions.filter((s) =>
    s.conversationId.startsWith(id)
  );

  if (prefixMatches.length === 1) return prefixMatches[0].path;

  if (prefixMatches.length > 1) {
    const list = prefixMatches
      .map((s) => `  - ${s.conversationId} (${s.path})`)
      .join("\n");
    throw new Error(
      `Ambiguous Codex conversationId prefix '${id}'. Matches ${prefixMatches.length} sessions:\n${list}`
    );
  }

  throw new Error(
    `No Codex session found with conversationId matching '${id}'.`
  );
}

async function resolveByFilePath(target: string): Promise<string> {
  const abs = path.resolve(target);
  const base = path.basename(abs);

  if (!abs.endsWith(".jsonl")) {
    throw new Error(
      `Rollout file must have a .jsonl extension: ${abs}`
    );
  }

  if (!base.startsWith("rollout-")) {
    throw new Error(
      `Rollout file basename must start with 'rollout-': ${base}`
    );
  }

  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      throw new Error(`Rollout path is not a regular file: ${abs}`);
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`Rollout file does not exist: ${abs}`);
    }
    throw err;
  }

  return abs;
}
