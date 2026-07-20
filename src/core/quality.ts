import { HammaSession, SourceCli } from "./schema.js";

export type SessionConfidence = "high" | "medium" | "low";

export interface SessionRef {
  sourceCli: SourceCli;
  sessionId?: string;
  path: string;
  projectPathHint?: string;
  lastUpdatedAt: string;
  sizeBytes?: number;
}

export interface SessionCandidate {
  sourceCli: SourceCli;
  sessionId?: string;
  path: string;
  projectPathHint?: string;
  lastUpdatedAt: string;
  sizeBytes: number;
  score: number;
  confidence: SessionConfidence;
  resumable: boolean;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  signals: string[];
  reasons: string[];
}

const TRIVIAL_USER_MESSAGE = /^(?:hi|hello|hey|test|testing|ping|thanks?|thank you|ok|okay)[.!?\s]*$/i;
const TASK_SIGNAL = /\b(?:add|analy[sz]e|audit|build|change|continue|create|debug|design|diagnose|fix|implement|improve|install|investigate|migrate|optimi[sz]e|refactor|remove|repair|replace|resume|review|test|trace|update|verify|write)\b/i;
const FILE_SIGNAL = /(?:^|[\s`])(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]+\b/i;
const DECISION_SIGNAL = /\b(?:decided|decision|approach|trade-?off|because|instead of)\b/i;
const COMPLETION_SIGNAL = /\b(?:completed|done|fixed|implemented|shipped|updated|working)\b/i;
const VERIFICATION_SIGNAL = /\b(?:tests? pass(?:ed)?|typecheck pass(?:ed)?|build pass(?:ed)?|verified|verification)\b/i;
const AUTH_FAILURE = /\b(?:api error|authentication failed|login required|please (?:run )?\/?login|not logged in|unauthorized|forbidden|account tier|insufficient|401|403)\b/i;

// A session that is Hamma operating on itself (a `/hamma-handoff` skill
// invocation) is not a task to resume. These patterns match the skill's own
// injected body/sentinel, NOT incidental mentions of "hamma" — so real dev
// sessions inside the hamma repo are not falsely flagged.
const HAMMA_META_PATTERNS: RegExp[] = [
  /\[HAMMA_(?:ATTACH_ID:[0-9a-f-]+|CONTEXT_LOAD)\]/i,
  /^Attach Hamma repository memory '/i,
  /base directory for this skill:.*hamma-handoff/is,
  /recover the newest[\s\S]{0,80}?session[\s\S]{0,160}?(?:validate|handoff)/i,
  /\$hamma-handoff/i,
  /use\s+\$?hamma-handoff\s+to\s+continue/i,
];

function isHammaMeta(text: string): boolean {
  return HAMMA_META_PATTERNS.some((pattern) => pattern.test(text));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Score a normalized session for handoff-worthiness. Adapter-agnostic: operates
 * purely on the shared HammaSession shape, so Codex and Claude rank identically.
 */
export function scoreSession(
  session: HammaSession,
  reference: SessionRef
): SessionCandidate {
  const base = {
    sourceCli: reference.sourceCli,
    sessionId: reference.sessionId,
    path: reference.path,
    projectPathHint: reference.projectPathHint,
    lastUpdatedAt: reference.lastUpdatedAt,
    sizeBytes: reference.sizeBytes ?? 0,
  };

  const userMessages = session.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);
  const assistantMessages = session.messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content.trim())
    .filter(Boolean);
  const meaningfulUsers = userMessages.filter(
    (message) => !TRIVIAL_USER_MESSAGE.test(message)
  );
  const userText = meaningfulUsers.join("\n");
  const allText = [...userMessages, ...assistantMessages].join("\n");
  const assistantText = assistantMessages.join("\n");

  const signals: string[] = [];
  const reasons: string[] = [];
  let score = Math.min(meaningfulUsers.length, 3) * 2;

  const hasTaskSignal = meaningfulUsers.some((message) => TASK_SIGNAL.test(message));
  const hasLongInstruction = meaningfulUsers.some((message) => message.length >= 40);
  if (hasTaskSignal) {
    score += 4;
    signals.push("task-instruction");
  }
  if (hasLongInstruction) {
    score += 2;
    signals.push("substantive-instruction");
  }
  if (FILE_SIGNAL.test(allText)) {
    score += 2;
    signals.push("file-reference");
  }
  if (DECISION_SIGNAL.test(allText)) {
    score += 2;
    signals.push("decision-context");
  }
  if (COMPLETION_SIGNAL.test(assistantText)) {
    score += 2;
    signals.push("completion-status");
  }
  if (VERIFICATION_SIGNAL.test(assistantText)) {
    score += 3;
    signals.push("verification");
  }
  if (session.messages.length >= 4) {
    score += 1;
    signals.push("multi-turn");
  }

  const authFailures = assistantMessages.filter((message) => AUTH_FAILURE.test(message));
  const nonFailureAssistantMessages = assistantMessages.filter(
    (message) => !AUTH_FAILURE.test(message)
  );
  const terminalAuthFailure =
    authFailures.length > 0 && nonFailureAssistantMessages.length === 0;
  if (authFailures.length > 0) {
    signals.push("authentication-failure");
    if (terminalAuthFailure) {
      score -= 6;
      reasons.push("assistant output contains only an authentication failure");
    } else {
      score -= 1;
      reasons.push("session contains an authentication failure");
    }
  }

  if (meaningfulUsers.length === 0) {
    score -= 6;
    reasons.push("no meaningful user instruction");
  }
  if (!hasTaskSignal && !hasLongInstruction) {
    reasons.push("no task or substantive instruction detected");
  }

  // Self-referential Hamma sessions must never be selected for a handoff.
  const hammaMeta = isHammaMeta(userText);
  if (hammaMeta) {
    signals.push("hamma-meta");
    reasons.push("session is a Hamma handoff operation, not a task to resume");
    score -= 20;
  }

  const hasSubstantiveGoal = hasTaskSignal || hasLongInstruction;
  const confidence: SessionConfidence =
    hammaMeta || terminalAuthFailure
      ? "low"
      : hasSubstantiveGoal && score >= 8
        ? "high"
        : hasSubstantiveGoal && score >= 4
          ? "medium"
          : "low";

  return {
    ...base,
    score,
    confidence,
    resumable: confidence !== "low" && !hammaMeta,
    messageCount: session.messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    signals: unique(signals),
    reasons: unique(reasons),
  };
}

export function unparsableCandidate(
  reference: SessionRef,
  message: string
): SessionCandidate {
  return {
    sourceCli: reference.sourceCli,
    sessionId: reference.sessionId,
    path: reference.path,
    projectPathHint: reference.projectPathHint,
    lastUpdatedAt: reference.lastUpdatedAt,
    sizeBytes: reference.sizeBytes ?? 0,
    score: -10,
    confidence: "low",
    resumable: false,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    signals: [],
    reasons: [`session could not be parsed: ${message}`],
  };
}

/**
 * Sort candidates best-first: resumable ahead of non-resumable, then by score
 * (quality dominates), with recency only as a tie-break. This is the fix for
 * the ranker previously preferring a trivial fresh session over substantial
 * older work.
 */
export function rankCandidates(candidates: SessionCandidate[]): SessionCandidate[] {
  return [...candidates].sort((left, right) => {
    if (left.resumable !== right.resumable) return left.resumable ? -1 : 1;
    if (right.score !== left.score) return right.score - left.score;
    return (
      new Date(right.lastUpdatedAt).getTime() -
      new Date(left.lastUpdatedAt).getTime()
    );
  });
}

/**
 * Assess and rank a set of session references using a caller-provided loader
 * that normalizes each reference into a HammaSession.
 */
export async function rankSessions<R extends SessionRef>(
  references: R[],
  load: (reference: R) => Promise<HammaSession>
): Promise<SessionCandidate[]> {
  const candidates = await Promise.all(
    references.map(async (reference) => {
      try {
        const session = await load(reference);
        return scoreSession(session, reference);
      } catch (error: any) {
        return unparsableCandidate(reference, error.message ?? "unknown error");
      }
    })
  );
  return rankCandidates(candidates);
}
