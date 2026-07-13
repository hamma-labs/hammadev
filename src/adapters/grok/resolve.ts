import fs from "node:fs/promises";
import path from "node:path";
import { discoverGrokSessions, GrokSessionRef } from "./discover.js";
import { filterSessionsByProject } from "../../core/project-match.js";
import { defaultGrokHome } from "./paths.js";

export interface ResolveGrokOptions {
  grokHome?: string;
  projectPath?: string;
}

const GROK_PREFIX = "grok:";

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
    // matches are sorted newest first by discover
    return matches[0].sessionId;
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
): Promise<{ projectPath: string; candidates: GrokSessionRef[] }> {
  const sessions = await discoverGrokSessions(grokHome);
  const { requestedProject, matches } = await filterSessionsByProject(
    sessions,
    projectPath
  );
  return { projectPath: requestedProject, candidates: matches };
}
