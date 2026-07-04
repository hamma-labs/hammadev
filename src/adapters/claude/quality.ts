import { ClaudeSessionRef } from "./discover.js";
import { parseClaudeSession } from "./parse.js";
import {
  SessionCandidate,
  scoreSession,
  unparsableCandidate,
  rankCandidates,
} from "../../core/quality.js";

export type { SessionConfidence as ClaudeSessionConfidence } from "../../core/quality.js";
export type ClaudeSessionCandidate = SessionCandidate;

export async function assessClaudeSession(
  reference: ClaudeSessionRef
): Promise<ClaudeSessionCandidate> {
  try {
    const session = await parseClaudeSession(reference.path);
    return scoreSession(session, reference);
  } catch (error: any) {
    return unparsableCandidate(reference, error.message ?? "unknown error");
  }
}

export async function rankClaudeSessions(
  references: ClaudeSessionRef[]
): Promise<ClaudeSessionCandidate[]> {
  const candidates = await Promise.all(references.map(assessClaudeSession));
  return rankCandidates(candidates);
}
