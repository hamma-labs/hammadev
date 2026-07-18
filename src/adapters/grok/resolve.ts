import fs from "node:fs/promises";
import path from "node:path";
import { discoverGrokSessions, GrokSessionRef } from "./discover.js";
import { filterSessionsByProject } from "../../core/project-match.js";
import { defaultGrokHome } from "./paths.js";
import { parseGrokSession } from "./parse.js";
import {
  rankSessions,
  SessionCandidate,
  SessionRef,
} from "../../core/quality.js";

export interface ResolveGrokOptions {
  grokHome?: string;
  projectPath?: string;
}

const GROK_PREFIX = "grok:";

function toSessionRef(session: GrokSessionRef): SessionRef {
  return {
    sourceCli: "grok",
    sessionId: session.sessionId,
    path: session.sessionDir,
    projectPathHint: session.projectPathHint,
    lastUpdatedAt: session.lastUpdatedAt,
    sizeBytes: session.sizeBytes,
  };
}

async function rankGrokSessions(
  sessions: GrokSessionRef[]
): Promise<SessionCandidate[]> {
  return rankSessions(sessions.map(toSessionRef), (reference) =>
    parseGrokSession(reference.path)
  );
}

export async function resolveGrokTarget(
  target: string,
  options: ResolveGrokOptions = {}
): Promise<string> {
  if (!target.startsWith(GROK_PREFIX)) {
    // allow bare ids to pass through (parse will locate)
    return target;
  }

  const rest = target.slice(GROK_PREFIX.length);
  if (!rest) {
    throw new Error(
      `Invalid Grok target '${target}'. Expected 'grok:last', 'grok:project', or 'grok:<sessionId>'.`
    );
  }

  const sessions = await discoverGrokSessions(options.grokHome);

  if (rest === "last" || rest === "latest") {
    if (sessions.length === 0) throw new Error("No Grok sessions found.");
    return sessions[0].sessionId;
  }

  if (rest === "project" || rest === "current" || rest === "previous") {
    if (!options.projectPath) {
      throw new Error(
        `Resolving 'grok:${rest}' requires a project path. Pass --project <path>.`
      );
    }
    const { matches } = await filterSessionsByProject(sessions, options.projectPath);
    if (matches.length === 0) {
      throw new Error(`No Grok session found for project '${options.projectPath}'.`);
    }
    if (rest === "current") return matches[0].sessionId;

    const eligible = rest === "previous" ? matches.slice(1) : matches;
    if (eligible.length === 0) {
      throw new Error(
        `No previous Grok session found for project '${options.projectPath}' (only the current session exists).`
      );
    }
    const candidates = await rankGrokSessions(eligible);
    const selected = candidates.find((candidate) => candidate.resumable);
    if (!selected?.sessionId) {
      throw new Error(
        `No resumable Grok session found for project '${options.projectPath}'.`
      );
    }
    return selected.sessionId;
  }

  // direct id (exact or prefix match)
  const match = sessions.find(
    (s) => s.sessionId === rest || s.sessionId.startsWith(rest)
  );
  if (match) return match.sessionId;

  // assume caller passed a full/partial id that exists on disk even if not indexed in this scan
  return rest;
}

export async function listGrokProjectCandidates(
  projectPath: string,
  grokHome?: string
): Promise<{ projectPath: string; candidates: SessionCandidate[] }> {
  const sessions = await discoverGrokSessions(grokHome);
  const { requestedProject, matches } = await filterSessionsByProject(
    sessions,
    projectPath
  );
  return {
    projectPath: requestedProject,
    candidates: await rankGrokSessions(matches),
  };
}
