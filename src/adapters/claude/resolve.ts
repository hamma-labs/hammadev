import {
  ClaudeSessionRef,
  discoverClaudeSessions
} from "./discover.js";
import {
  ClaudeSessionCandidate,
  rankClaudeSessions
} from "./quality.js";
import { filterSessionsByProject } from "../../core/project-match.js";

const CLAUDE_PREFIX = "claude:";

export interface ResolveClaudeOptions {
  claudeHomes?: string[];
  projectPath?: string;
}

async function projectSessions(
  sessions: ClaudeSessionRef[],
  projectPath: string
): Promise<{ requestedProject: string; matches: ClaudeSessionRef[] }> {
  return filterSessionsByProject(sessions, projectPath);
}

function candidateSummary(candidate: ClaudeSessionCandidate): string {
  const id = candidate.sessionId ?? "unknown-session-id";
  const signals = candidate.signals.length > 0
    ? candidate.signals.join(", ")
    : "none";
  const reasons = candidate.reasons.length > 0
    ? candidate.reasons.join("; ")
    : "none";
  return `  - ${id} | updated ${candidate.lastUpdatedAt} | confidence ${candidate.confidence} | score ${candidate.score} | signals: ${signals} | reasons: ${reasons}`;
}

export async function listClaudeProjectCandidates(
  projectPath: string,
  claudeHomes?: string[]
): Promise<{ projectPath: string; candidates: ClaudeSessionCandidate[] }> {
  const sessions = await discoverClaudeSessions(claudeHomes);
  const { requestedProject, matches } = await projectSessions(
    sessions,
    projectPath
  );
  return {
    projectPath: requestedProject,
    candidates: await rankClaudeSessions(matches)
  };
}

export async function resolveClaudeTarget(
  target: string,
  options: ResolveClaudeOptions = {}
): Promise<string> {
  if (!target.startsWith(CLAUDE_PREFIX)) {
    throw new Error(
      `Invalid Claude target '${target}'. Expected 'claude:last' or 'claude:<sessionId>'.`
    );
  }

  const rest = target.slice(CLAUDE_PREFIX.length);
  if (!rest) {
    throw new Error(
      `Invalid Claude target '${target}'. Expected 'claude:last' or 'claude:<sessionId>'.`
    );
  }

  const sessions = await discoverClaudeSessions(options.claudeHomes);
  if (sessions.length === 0) {
    throw new Error(
      "No Claude Code session files found. Looked under ~/.claude, ~/.config/claude, and ~/.local/share/claude."
    );
  }

  if (rest === "last") return sessions[0].path;

  if (rest === "current" || rest === "previous") {
    if (!options.projectPath) {
      throw new Error(
        `Resolving 'claude:${rest}' requires a project path. Pass --project <path>.`
      );
    }

    const { requestedProject, matches } = await projectSessions(
      sessions,
      options.projectPath
    );

    if (matches.length === 0) {
      throw new Error(
        `No Claude session found for project '${requestedProject}'.`
      );
    }

    // `matches` preserves discovery order (newest-mtime first). The current
    // session is the one being actively written = newest mtime.
    if (rest === "current") {
      return matches[0].path;
    }

    // `previous`: exclude self (newest mtime), then pick the newest *resumable*
    // session — recency-first, since "continue where I left off" is a recency
    // intent, not a quality one.
    const withoutSelf = matches.slice(1);
    if (withoutSelf.length === 0) {
      throw new Error(
        `No previous Claude session found for project '${requestedProject}' (only the current session exists).`
      );
    }

    const candidates = await rankClaudeSessions(withoutSelf);
    const resumablePaths = new Set(
      candidates.filter((candidate) => candidate.resumable).map((c) => c.path)
    );
    const selected = withoutSelf.find((s) => resumablePaths.has(s.path));
    if (!selected) {
      const details = candidates.slice(0, 10).map(candidateSummary).join("\n");
      throw new Error(
        `No resumable previous Claude session found for project '${requestedProject}'.\n` +
        `Candidate sessions:\n${details}\n` +
        `Select one explicitly with claude:<sessionId> if this assessment is incorrect.`
      );
    }

    return selected.path;
  }

  if (rest === "project") {
    if (!options.projectPath) {
      throw new Error(
        "Resolving 'claude:project' requires a project path. Pass --project <path>."
      );
    }

    const { requestedProject, matches } = await projectSessions(
      sessions,
      options.projectPath
    );

    if (matches.length === 0) {
      throw new Error(
        `No Claude session found for project '${requestedProject}'.`
      );
    }

    const candidates = await rankClaudeSessions(matches);
    const selected = candidates.find((candidate) => candidate.resumable);
    if (!selected) {
      const details = candidates.slice(0, 10).map(candidateSummary).join("\n");
      throw new Error(
        `No resumable Claude session found for project '${requestedProject}'.\n` +
        `Candidate sessions:\n${details}\n` +
        `Select one explicitly with claude:<sessionId> if this assessment is incorrect.`
      );
    }

    return selected.path;
  }

  return resolveBySessionId(rest, sessions);
}

function resolveBySessionId(id: string, sessions: ClaudeSessionRef[]): string {
  const withIds = sessions.filter(
    (s): s is ClaudeSessionRef & { sessionId: string } => !!s.sessionId
  );

  const exact = withIds.find((s) => s.sessionId === id);
  if (exact) return exact.path;

  const prefixMatches = withIds.filter((s) => s.sessionId.startsWith(id));

  if (prefixMatches.length === 1) return prefixMatches[0].path;

  if (prefixMatches.length > 1) {
    const list = prefixMatches
      .map((s) => `  - ${s.sessionId} (${s.path})`)
      .join("\n");
    throw new Error(
      `Ambiguous Claude sessionId prefix '${id}'. Matches ${prefixMatches.length} sessions:\n${list}`
    );
  }

  throw new Error(
    `No Claude session found with sessionId matching '${id}'.`
  );
}
