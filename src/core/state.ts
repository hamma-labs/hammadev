import { HammaMessage, HammaSession } from "./schema.js";
import { normalizeFilesMentioned } from "./files.js";
import { GitRepositorySnapshot } from "./git-snapshot.js";
import type { HandoffReadinessResult } from "./readiness.js";

export const HANDOFF_SCHEMA_VERSION = 1 as const;

export type HammaHandoffOutcome =
  | "completed"
  | "actionable"
  | "blocked"
  | "ambiguous";

export interface HammaTaskLedgerItem {
  id?: string;
  title?: string;
  status: "completed" | "in_progress" | "remaining" | "blocked" | "unknown";
  summary: string;
  evidence: string[];
  risks: string[];
  filesMentioned: string[];
}

export interface HammaRepoState {
  gitStatusShort?: string;
  gitDiffStat?: string;
  snapshot?: GitRepositorySnapshot;
  warnings: string[];
}

export type HammaEvidenceSource =
  | "agent_claim"
  | "command"
  | "repository"
  | "tool"
  | "user_confirmation";

export type HammaEvidenceStatus =
  | "claimed"
  | "observed"
  | "passed"
  | "failed"
  | "confirmed";

export interface HammaEvidenceItem {
  source: HammaEvidenceSource;
  kind: string;
  status: HammaEvidenceStatus;
  summary: string;
  command?: string;
  exitCode?: number;
  timestamp?: string;
}

export interface HammaTaskState {
  schemaVersion: typeof HANDOFF_SCHEMA_VERSION;
  outcome: HammaHandoffOutcome;
  nextAction?: string;
  goal?: string;
  project: {
    path?: string;
    sourceCli: string;
    targetCli: string;
    sourceSessionId?: string;
    sourcePath?: string;
    startedAt?: string;
    lastUpdatedAt?: string;
  };
  current: {
    latestUserInstruction?: string;
    latestAssistantStatus?: string;
    nextRecommendedTask?: string;
  };
  tasks: HammaTaskLedgerItem[];
  verification: string[];
  evidence: HammaEvidenceItem[];
  risks: string[];
  filesMentioned: string[];
  repoState: HammaRepoState;
  readiness?: HandoffReadinessResult;
  references: {
    fullSession: string;
    timeline: string;
    commands: string;
    redactionReport: string;
  };
}

const IMPORTANT_USER_WORDS =
  /\b(audit|assess|fix|build|implement|proceed|resume|continue|task|verify|use mcp|minimize|do not)\b/i;

const COMPLETED_PATTERNS: RegExp[] = [
  /Task #?(\d+)\s+completed/gi,
  /Task #?(\d+)\s+fixed/gi,
  /Fixed finding #?(\d+)/gi,
  /Task #?(\d+)[^\n]*?(?:done|complete|finished|implemented|shipped|merged)/gi,
  /#?(\d+)\s+(?:is )?(?:done|completed|fixed|implemented)/gi,
  /(?:completed|finished|done with)\s+(?:task|finding)\s*#?(\d+)/gi,
];

const REMAINING_PATTERNS: RegExp[] = [
  /Next is task #?(\d+)(?::\s*([^\n.]+))?/gi,
  /Remaining[^\n.]*task #?(\d+)(?::\s*([^\n.]+))?/gi,
  /task #?(\d+)\s+remains/gi,
  /task #?(\d+)[^\n.!?]*?(?:next|remain|todo|pending|still to do)/gi,
];

const EXPLICIT_NEXT_ACTION =
  /\b(?:next action|next step)\s*:\s*([^\n]+)/i;

const LATEST_STATUS_MARKER =
  /\b(?:task #?\d+ (?:completed|fixed)|fixed finding #?\d+|completed|passes|remaining|next is task)\b/i;

const BARE_CONTINUATION_INSTRUCTION =
  /^(?:please\s+)?(?:resume|continue|proceed|keep going)(?:\s+(?:the\s+)?(?:task|work))?[.!]?$/i;

const TERMINAL_COMPLETION_STATUS =
  /\b(?:all acceptance criteria (?:pass|passed)|all (?:tests?|checks?) (?:pass|passed)|(?:work|implementation|task) (?:is )?(?:complete|completed)|nothing (?:remains|is left)|no (?:remaining|further) (?:implementation )?(?:work|tasks?|changes))\b/i;

const UNRESOLVED_STATUS =
  /\b(?:remaining|next (?:step|task|action)|todo|still need|needs? to|failed|failing|cannot proceed)\b/i;

const BLOCKED_STATUS =
  /\b(?:blocked|cannot proceed|need(?:s)? (?:user )?(?:input|decision))\b/i;

const VERIFICATION_CATEGORIES: Array<{
  name: string;
  verb: string;
  patterns: RegExp[];
}> = [
  {
    name: "Typecheck",
    verb: "passes",
    patterns: [/\btypecheck[^\n]*(?:passes|passed|clean|ok|no errors)/i, /\btsc[^\n]*(?:passes|passed|clean|no errors)/i],
  },
  {
    name: "Production build",
    verb: "passes",
    patterns: [/production build[^\n]*(?:passes|passed|clean|succeed)/i, /\bbuild passes\b/i, /\bnpm run build\b[^\n]*(?:passes|passed|clean|succeed|success)/i],
  },
  {
    name: "Targeted ESLint",
    verb: "passes",
    patterns: [
      /targeted eslint/i,
      /\beslint\b[^\n]*(?:passes|passed|0 errors|no errors|clean)/i,
      /\blint\b[^\n]*(?:passes|passed|clean|0 errors)/i,
    ],
  },
  {
    name: "Tests",
    verb: "pass",
    patterns: [/tests?:\s*\d+\/\d+/i, /\b\d+\/\d+\s*(?:tests?\s*)?pass/i, /\ball tests pass\b/i],
  },
  {
    name: "Browser/Playwright checks",
    verb: "verified",
    patterns: [/browser-tested/i, /\bplaywright\b[^\n]*(?:verified|passes|passed|checks?)/i, /playwright mcp/i, /browser mcp/i],
  },
];

const RISK_SIGNALS: RegExp[] = [
  /\bpre-existing\b/i,
  /\bstill\s+(?:has|have|failing|failing?)\b/i,
  /\bfailed\b/i,
  /\bblocked\b/i,
  /\bregression risk\b/i,
  /unrelated worktree changes/i,
  /\bknown (?:issue|risk|failure|bug)\b/i,
  /\bcaveat\b/i,
];

const RISK_NEGATION_SIGNALS: RegExp[] = [
  /\bnow passes\b/i,
  /\bpasses both\b/i,
  /\bpassed both\b/i,
  /\ball green\b/i,
  /\bno more\b/i,
  /\bno longer\b/i,
  /\bnow (?:fixed|resolved|cleared|clean)\b/i,
  /added [^\n]*?(?:test|regression|coverage)/i,
];

const USER_CONFIRMATION =
  /^(?:approved|confirmed|looks good|works for me|that works|this works|tests pass(?:ed)?|verified)(?:[.!\s].*)?$/i;

interface CommandClassification {
  kind: string;
  verification: boolean;
}

function classifyEvidenceCommand(command: string): CommandClassification {
  const normalized = command.toLowerCase();
  if (
    /\b(?:vitest|pytest|jest|cargo\s+test|go\s+test)\b|\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b/.test(
      normalized
    )
  ) {
    return { kind: "tests", verification: true };
  }
  if (/\btypecheck\b|\btsc\b(?:\s+--noemit)?/.test(normalized)) {
    return { kind: "typecheck", verification: true };
  }
  if (
    /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b|\bcargo\s+build\b/.test(
      normalized
    )
  ) {
    return { kind: "build", verification: true };
  }
  if (
    /\b(?:eslint|biome|ruff|clippy)\b|\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?lint\b/.test(
      normalized
    )
  ) {
    return { kind: "lint", verification: true };
  }
  return { kind: "tool_execution", verification: false };
}

function commandExitCode(
  exitCode: number | undefined,
  output: string | undefined
): number | undefined {
  if (typeof exitCode === "number") return exitCode;
  if (!output) return undefined;
  const match = output.match(
    /(?:"exit_code"\s*:\s*|\bexit code\s+|\bprocess exited with code\s+)(-?\d+)/i
  );
  return match ? Number(match[1]) : undefined;
}

function evidenceKey(item: HammaEvidenceItem): string {
  return `${item.source}\0${item.kind}\0${item.status}\0${item.summary}`;
}

function dedupEvidence(items: HammaEvidenceItem[]): HammaEvidenceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = evidenceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isImportantUserMessage(content: string): boolean {
  return IMPORTANT_USER_WORDS.test(content);
}

function isBareContinuationInstruction(content: string): boolean {
  return BARE_CONTINUATION_INSTRUCTION.test(content.trim());
}

function isTerminalCompletionStatus(content: string): boolean {
  return TERMINAL_COMPLETION_STATUS.test(content) && !UNRESOLVED_STATUS.test(content);
}

function isBlockedStatus(content: string): boolean {
  return BLOCKED_STATUS.test(content) && !RISK_NEGATION_SIGNALS.some((pattern) => pattern.test(content));
}

export function getMessageImportance(msg: HammaMessage): "high" | "medium" | "low" {
  if (msg.role === "system") return "low";
  if (msg.role === "user") {
    return isImportantUserMessage(msg.content) ? "high" : "medium";
  }
  const c = msg.content;
  if (
    COMPLETED_PATTERNS.some((p) => new RegExp(p.source, p.flags.replace("g", "")).test(c)) ||
    REMAINING_PATTERNS.some((p) => new RegExp(p.source, p.flags.replace("g", "")).test(c)) ||
    VERIFICATION_CATEGORIES.some((cat) => cat.patterns.some((p) => p.test(c))) ||
    /\bnext is task\b/i.test(c) ||
    /\bfixed finding\b/i.test(c)
  ) {
    return "high";
  }
  if (RISK_SIGNALS.some((p) => p.test(c))) return "medium";
  return "low";
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd() + "…";
}

function firstParagraph(text: string, max: number): string {
  const cleaned = text.trim();
  const block = cleaned.split(/\n\s*\n/)[0] ?? cleaned;
  return truncate(block, max);
}

function mergeUnique(a: string[], b: string[]): string[] {
  const s = new Set<string>();
  for (const x of a) if (x) s.add(x);
  for (const x of b) if (x) s.add(x);
  return Array.from(s);
}

function stripLineCol(p: string): string {
  return p.replace(/:\d+(?::\d+)?$/, "");
}

function stripTrailingPunct(p: string): string {
  return p.replace(/[)\],.:;!?'"`>]+$/, "");
}

export function extractFilePaths(text: string): string[] {
  const found = new Set<string>();

  const dirRe =
    /(?:^|[\s`"'([\]<>])((?:[/A-Za-z0-9_.-]+)?(?:src|app|components|lib|pages|public|scripts|tests?|hooks|utils|styles|content|config|api|server|packages)\/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?)/g;
  for (const m of text.matchAll(dirRe)) {
    let p = stripTrailingPunct(m[1]);
    p = stripLineCol(p);
    if (p.length >= 3 && p.length <= 300) found.add(p);
  }

  const extRe =
    /(?:^|[\s`"'([\]<>/])([A-Za-z0-9_.-]+\.(?:tsx?|jsx?|css|json|md|ya?ml|html|toml))(?=[\s`"')\]:>,.]|$)/g;
  for (const m of text.matchAll(extRe)) {
    const p = stripTrailingPunct(m[1]);
    if (p.length >= 3 && p.length <= 300 && !/^\.+$/.test(p)) found.add(p);
  }

  const absRe =
    /(\/(?:home|Users|root|tmp|var|opt|workspace|srv)\/[A-Za-z0-9_\-./]+(?::\d+(?::\d+)?)?)/g;
  for (const m of text.matchAll(absRe)) {
    let p = stripTrailingPunct(m[1]);
    p = stripLineCol(p);
    if (/\.[A-Za-z0-9]+$/.test(p) && p.length <= 300) found.add(p);
  }

  return Array.from(found);
}

interface PlanItem {
  id: string;
  title: string;
}

function cleanTitle(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(/^(Critical|High|Medium|Low):\s*/i, "");
  // Take up to the first sentence-ending punctuation followed by a space and a capital letter
  const sentenceMatch = t.match(/^([\s\S]+?[.!?])\s+[A-Z]/);
  if (sentenceMatch && sentenceMatch[1].length >= 10) {
    t = sentenceMatch[1];
  }
  // Strip trailing "See [ref](path)..."
  t = t.replace(/\s+See\s+\[[^\n]*$/, "");
  // Strip trailing punctuation
  t = t.replace(/[:.,;\s]+$/, "");
  if (t.length === 0) return t;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

function extractPlanItems(text: string): PlanItem[] {
  const items: PlanItem[] = [];
  const re = /(?:^|\n)\s{0,4}(\d+)\.\s+(.{5,400}?)(?=\n\s{0,4}\d+\.\s|\n\s*\n|$)/gs;
  for (const m of text.matchAll(re)) {
    const id = m[1];
    const title = cleanTitle(m[2]);
    if (title.length >= 5 && title.length <= 220) {
      items.push({ id, title });
    }
  }
  return items;
}

interface TitleCandidate {
  title: string;
  priority: number;
  order: number;
}

function splitClauses(text: string): string[] {
  const clauses: string[] = [];
  for (const line of text.split(/\n+/)) {
    const cleaned = line.replace(/^[\s>*\-–—•]+/, "").trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/(?<=[.!?])\s+(?=[A-Z"`\[])|;\s+/);
    for (const part of parts) {
      const t = part.trim();
      if (t.length >= 6) clauses.push(t);
    }
  }
  return clauses;
}

function taskClauseSummary(
  text: string,
  id: string,
  status: "completed" | "remaining",
  max: number
): string {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const taskReference = new RegExp(`\\b(?:task|finding)\\s*#?${escapedId}\\b`, "i");
  const statusSignal = status === "completed"
    ? /\b(?:completed|complete|done|fixed|finished|implemented|shipped|merged)\b/i
    : /\b(?:next|remain|remaining|todo|pending|still to do)\b/i;
  const clauses = splitClauses(text);
  const matchingStatus = clauses.find(
    (clause) => taskReference.test(clause) && statusSignal.test(clause)
  );
  const matchingTask = clauses.find((clause) => taskReference.test(clause));
  return truncate(matchingStatus ?? matchingTask ?? firstParagraph(text, max), max);
}

function explicitNextAction(text: string): string | undefined {
  const match = text.match(EXPLICIT_NEXT_ACTION);
  if (!match) return undefined;
  const [firstClause] = splitClauses(match[1]);
  const action = truncate(firstClause ?? match[1], 240);
  return action || undefined;
}

function extendPatterns(base: RegExp[], additional?: RegExp[]): RegExp[] {
  if (!additional?.length) return base;
  const seen = new Set(base.map((pattern) => `${pattern.source}\0${pattern.flags}`));
  return [
    ...base,
    ...additional.filter((pattern) => {
      const key = `${pattern.source}\0${pattern.flags}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

function isActionableRisk(clause: string): boolean {
  const hasRisk = RISK_SIGNALS.some((p) => p.test(clause));
  if (!hasRisk) return false;
  const negated = RISK_NEGATION_SIGNALS.some((p) => p.test(clause));
  return !negated;
}

function tokenizeForSimilarity(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function dedupRisks(risks: string[], maxItems = 8): string[] {
  const kept: string[] = [];
  for (const raw of risks) {
    const r = raw.replace(/\s+/g, " ").trim();
    if (!r) continue;
    const tr = tokenizeForSimilarity(r);
    let mergedInto = -1;
    for (let i = 0; i < kept.length; i++) {
      const tk = tokenizeForSimilarity(kept[i]);
      const inter = [...tr].filter((w) => tk.has(w));
      const smaller = Math.min(tr.size, tk.size);
      if (smaller > 0 && inter.length / smaller > 0.6) {
        mergedInto = i;
        break;
      }
    }
    if (mergedInto === -1) {
      kept.push(r);
    } else if (r.length < kept[mergedInto].length) {
      kept[mergedInto] = r;
    }
    if (kept.length >= maxItems) break;
  }
  return kept;
}

/**
 * extractTaskState turns a (source-agnostic) HammaSession into the universal
 * HammaTaskState used for all handoff artifacts.
 *
 * Extension point for source-specific heuristics:
 *   Pass `heuristics: { completedPatterns?, remainingPatterns? }` to extend
 *   the base regex sets for a particular sourceCli without forking the rest
 *   of normalization (title extraction, verification bucketing, risk signals,
 *   file normalization, etc. remain common).
 *
 * Preferred: adapters attach to the HammaSession so core call sites need no change:
 *   const s = { meta: {sourceCli: 'grok', ...}, messages: [...], extractionHints: { completedPatterns: [ /.../ ] } };
 *   extractTaskState(s, { targetCli, repoState });
 *
 *   (tests may pass explicit heuristics: )
 */
export function extractTaskState(
  session: HammaSession,
  options: {
    targetCli: string;
    repoState: HammaRepoState;
    heuristics?: {
      completedPatterns?: RegExp[];
      remainingPatterns?: RegExp[];
    };
  }
): HammaTaskState {
  const { targetCli, repoState, heuristics } = options;

  // Prefer hints attached by the source adapter (on HammaSession) so that
  // source-specific heuristic knowledge stays in adapters/ (AC2).
  // Fall back to explicit options.heuristics (for tests).
  const heurs = heuristics ?? session.extractionHints;
  const completedPats = extendPatterns(COMPLETED_PATTERNS, heurs?.completedPatterns);
  const remainingPats = extendPatterns(REMAINING_PATTERNS, heurs?.remainingPatterns);

  const messages = session.messages.filter((m) => m.role !== "system");

  // Single forward pass over messages to accumulate tasks, verification, risks, files, users, status
  const users: HammaMessage[] = [];
  const assistants: HammaMessage[] = [];
  const importantUsers: HammaMessage[] = [];
  let latestImportantUser: HammaMessage | undefined = undefined;
  let latestStatusAssistant: HammaMessage | undefined = undefined;

  const tasksById = new Map<string, HammaTaskLedgerItem>();

  interface Bucket {
    name: string;
    verb: string;
    count: number;
    lastNumericSample?: string;
  }
  const buckets: Bucket[] = VERIFICATION_CATEGORIES.map((c) => ({
    name: c.name,
    verb: c.verb,
    count: 0,
  }));

  const riskRaw: string[] = [];
  const fileSet = new Set<string>();
  const evidenceRaw: HammaEvidenceItem[] = [];

  // title candidate accumulation inside the single pass (eliminates full post-pass buildTitleRegistry content re-scan)
  const titleCandidates = new Map<string, TitleCandidate[]>();
  let titleOrder = 0;
  const addTitle = (id: string, rawTitle: string, priority: number) => {
    const title = cleanTitle(rawTitle);
    if (title.length < 5 || title.length > 220) return;
    const arr = titleCandidates.get(id) ?? [];
    arr.push({ title, priority, order: titleOrder++ });
    titleCandidates.set(id, arr);
  };
  const introPatterns: Array<{ re: RegExp; priority: number }> = [
    {
      re: /(?:I(?:'m|['’]m|['’]ve| am)?\s+(?:proceeding|starting|working|treating this as fixing|treating this as|kicking off))\s+(?:with\s+|on\s+|as\s+)?(?:finding|task)\s*#?(\d+):\s*([^\n]{6,300})/gi,
      priority: 4,
    },
    {
      re: /Next is\s+(?:task|finding)\s*#?(\d+):\s*([^\n]{6,300})/gi,
      priority: 3,
    },
    {
      re: /Fixed finding\s*#?(\d+):\s*([^\n]{6,300})/gi,
      priority: 2,
    },
  ];

  for (const msg of messages) {
    if (msg.role === "user") {
      users.push(msg);
      if (isImportantUserMessage(msg.content)) {
        importantUsers.push(msg);
      }
      if (USER_CONFIRMATION.test(msg.content.trim())) {
        evidenceRaw.push({
          source: "user_confirmation",
          kind: "task_status",
          status: "confirmed",
          summary: truncate(msg.content, 200),
          timestamp: msg.timestamp,
        });
      }
      const trimmed = msg.content.trim();
      if ((isImportantUserMessage(msg.content) && trimmed.length >= 20) || trimmed.length > 60) {
        latestImportantUser = msg;
      }
      for (const p of extractFilePaths(msg.content)) fileSet.add(p);
    } else if (msg.role === "assistant") {
      assistants.push(msg);
      if (LATEST_STATUS_MARKER.test(msg.content)) {
        latestStatusAssistant = msg;
      }

      // Compute files once per assistant (avoid redundant extractFilePaths per pattern match)
      const files = extractFilePaths(msg.content);
      for (const p of files) fileSet.add(p);

      // Completed / remaining task detection (varied phrasing supported via extended patterns)
      for (const pat of completedPats) {
        for (const mm of msg.content.matchAll(pat)) {
          const id = mm[1];
          const existing = tasksById.get(id);
          const summary = taskClauseSummary(msg.content, id, "completed", 400);
          tasksById.set(id, {
            id,
            title: undefined, // filled from registry later
            status: "completed",
            summary: existing?.status === "completed" && existing.summary ? existing.summary : summary,
            evidence: mergeUnique(existing?.evidence ?? [], msg.timestamp ? [msg.timestamp] : []),
            risks: existing?.risks ?? [],
            filesMentioned: normalizeFilesMentioned(mergeUnique(existing?.filesMentioned ?? [], files)),
          });
        }
      }

      for (const pat of remainingPats) {
        for (const mm of msg.content.matchAll(pat)) {
          const id = mm[1];
          const existing = tasksById.get(id);
          if (existing && existing.status === "completed") continue;
          tasksById.set(id, {
            id,
            title: undefined,
            status: "remaining",
            summary: existing?.summary || taskClauseSummary(msg.content, id, "remaining", 300),
            evidence: mergeUnique(existing?.evidence ?? [], msg.timestamp ? [msg.timestamp] : []),
            risks: existing?.risks ?? [],
            filesMentioned: normalizeFilesMentioned(mergeUnique(existing?.filesMentioned ?? [], files)),
          });
        }
      }

      // title extraction inside single pass
      for (const { re, priority } of introPatterns) {
        for (const m of msg.content.matchAll(re)) {
          addTitle(m[1], m[2], priority);
        }
      }
      for (const item of extractPlanItems(msg.content)) {
        addTitle(item.id, item.title, 1);
      }

      // verification accumulation in same pass
      for (const rawLine of msg.content.split(/\n/)) {
        const line = rawLine.replace(/^[\s>*\-–—•]+/, "").trim();
        if (!line) continue;
        for (let i = 0; i < VERIFICATION_CATEGORIES.length; i++) {
          const cat = VERIFICATION_CATEGORIES[i];
          if (cat.patterns.some((p) => p.test(line))) {
            buckets[i].count += 1;
            evidenceRaw.push({
              source: "agent_claim",
              kind: cat.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
              status: "claimed",
              summary: truncate(line, 220),
              timestamp: msg.timestamp,
            });
            if (cat.name === "Tests") {
              const nm = line.match(/(\d+)\/(\d+)/);
              if (nm) buckets[i].lastNumericSample = `${nm[1]}/${nm[2]}`;
            }
            break;
          }
        }
      }

      // risks in pass
      for (const clause of splitClauses(msg.content)) {
        if (isActionableRisk(clause)) {
          riskRaw.push(truncate(clause, 240));
        }
      }
    }
  }

  for (const shell of session.shellCommands.slice(-20)) {
    const classification = classifyEvidenceCommand(shell.command);
    const exitCode = commandExitCode(shell.exitCode, shell.output);
    const status: HammaEvidenceStatus =
      exitCode === undefined ? "observed" : exitCode === 0 ? "passed" : "failed";
    evidenceRaw.push({
      source: classification.verification ? "command" : "tool",
      kind: classification.kind,
      status,
      summary: classification.verification
        ? `${classification.kind} command ${status}`
        : `Tool command ${status}`,
      command: truncate(shell.command, 200),
      exitCode,
      timestamp: shell.endedAt ?? shell.startedAt,
    });
  }

  if (repoState.snapshot?.available) {
    const snapshot = repoState.snapshot;
    evidenceRaw.push({
      source: "repository",
      kind: "git_snapshot",
      status: "observed",
      summary:
        `Git ${snapshot.head?.slice(0, 12) ?? "unborn"} on ` +
        `${snapshot.detachedHead ? "detached HEAD" : snapshot.branch ?? "unknown branch"}; ` +
        `${snapshot.changedFiles.length} changed file entr${snapshot.changedFiles.length === 1 ? "y" : "ies"}.`,
    });
  }

  if (!latestStatusAssistant && assistants.length > 0) {
    // preserve original fallback: last assistant if no explicit status marker matched
    latestStatusAssistant = assistants[assistants.length - 1];
  }

  const firstUser = users[0];
  const lastUser = users[users.length - 1];
  // Goal: favor most recent high-signal substantive user msg to reduce stale/polluted goals from session history
  const goalUser =
    (latestImportantUser && latestImportantUser.content.trim().length >= 20
      ? latestImportantUser
      : firstUser && firstUser.content.trim().length >= 20
      ? firstUser
      : latestImportantUser ?? firstUser);

  // build registry from in-pass accumulated candidates (no separate full scan of assistant contents)
  const titleRegistry = new Map<string, string>();
  for (const [id, list] of titleCandidates) {
    list.sort((a, b) => b.priority - a.priority || b.order - a.order);
    titleRegistry.set(id, list[0].title);
  }

  // fill titles into tasks from registry
  for (const [id, title] of titleRegistry) {
    const existing = tasksById.get(id);
    if (existing) {
      existing.title = existing.title || title;
    }
  }

  for (const [id, title] of titleRegistry) {
    if (tasksById.has(id)) continue;
    tasksById.set(id, {
      id,
      title,
      status: "remaining",
      summary: truncate(title, 300),
      evidence: [],
      risks: [],
      filesMentioned: [],
    });
  }

  let tasks = Array.from(tasksById.values()).sort((a, b) => {
    const na = Number(a.id ?? 0);
    const nb = Number(b.id ?? 0);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return 0;
  });

  // Ensure non-empty structured tasks (for cases previously "(none detected)") using recent substantive; only if last user is not bare continuation
  const lastIsBare = lastUser ? isBareContinuationInstruction(lastUser.content) : false;
  if (tasks.length === 0 && latestImportantUser && !lastIsBare) {
    tasks = [{
      id: undefined,
      title: undefined,
      status: "remaining",
      summary: truncate(latestImportantUser.content, 300),
      evidence: latestImportantUser.timestamp ? [latestImportantUser.timestamp] : [],
      risks: [],
      filesMentioned: normalizeFilesMentioned(extractFilePaths(latestImportantUser.content)),
    }];
  }

  // build verification results from buckets (post but from single-pass data)
  const verification: string[] = [];
  for (const b of buckets) {
    if (b.count === 0) continue;
    if (b.name === "Tests" && b.lastNumericSample) {
      verification.push(`Tests: ${b.lastNumericSample} pass (${b.count} agent claim${b.count === 1 ? "" : "s"})`);
    } else {
      verification.push(`${b.name}: ${b.verb} (${b.count} agent claim${b.count === 1 ? "" : "s"})`);
    }
  }
  const evidence = dedupEvidence(evidenceRaw);
  for (const item of evidence) {
    if (item.source !== "command") continue;
    const outcome = item.exitCode === undefined
      ? "outcome not recorded"
      : `exit ${item.exitCode}`;
    verification.push(
      `${item.kind}: command ${item.status} (${outcome})`
    );
  }

  const risksAgg = dedupRisks(riskRaw);
  const filesAgg = normalizeFilesMentioned(Array.from(fileSet));

  const remainingTasks = tasks.filter((t) => t.status === "remaining");
  const blockedTasks = tasks.filter((t) => t.status === "blocked");
  const messagesForIndex = messages; // already filtered
  const latestUserIndex = latestImportantUser ? messagesForIndex.lastIndexOf(latestImportantUser) : -1;
  const latestStatusIndex = latestStatusAssistant ? messagesForIndex.lastIndexOf(latestStatusAssistant) : -1;
  const statusFollowsLatestUser = latestStatusIndex > latestUserIndex;
  const lastUserForBare = users[users.length - 1];
  const latestUserIsBareContinuation = lastUserForBare
    ? isBareContinuationInstruction(lastUserForBare.content)
    : false;
  const latestStatusIsBlocked = Boolean(
    latestStatusAssistant && statusFollowsLatestUser && isBlockedStatus(latestStatusAssistant.content)
  );
  const latestStatusIsComplete = Boolean(
    latestStatusAssistant &&
      statusFollowsLatestUser &&
      isTerminalCompletionStatus(latestStatusAssistant.content)
  );

  let outcome: HammaHandoffOutcome;
  if (blockedTasks.length > 0 || latestStatusIsBlocked) {
    outcome = "blocked";
  } else if (
    latestStatusIsComplete ||
    (tasks.length > 0 && tasks.every((t) => t.status === "completed"))
  ) {
    outcome = "completed";
  } else if (remainingTasks.length > 0) {
    outcome = "actionable";
  } else if (lastUserForBare && !latestUserIsBareContinuation) {
    outcome = "actionable";
  } else {
    outcome = "ambiguous";
  }

  let nextRecommended: string | undefined;
  const statedNextAction = latestStatusAssistant
    ? explicitNextAction(latestStatusAssistant.content)
    : undefined;
  if (outcome === "blocked" && latestStatusAssistant) {
    nextRecommended = `Resolve blocker: ${firstParagraph(latestStatusAssistant.content, 200)}`;
  } else if (statedNextAction) {
    nextRecommended = statedNextAction;
  } else if (remainingTasks.length > 0) {
    const t = remainingTasks[0];
    const label = t.title ?? t.summary;
    nextRecommended = (t.id != null)
      ? `Task #${t.id}: ${truncate(label, 220)}`
      : truncate(label, 240);
  } else if (outcome === "actionable" && lastUserForBare && !latestUserIsBareContinuation) {
    nextRecommended = truncate(lastUserForBare.content, 240);
  }

  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    outcome,
    nextAction: nextRecommended,
    goal: goalUser ? truncate(goalUser.content, 500) : undefined,
    project: {
      path: session.meta.projectPath,
      sourceCli: session.meta.sourceCli,
      targetCli,
      sourceSessionId: session.meta.sourceSessionId,
      sourcePath: session.meta.sourcePath,
      startedAt: session.meta.startedAt,
      lastUpdatedAt: session.meta.lastUpdatedAt,
    },
    current: {
      latestUserInstruction: latestImportantUser
        ? truncate(latestImportantUser.content, 500)
        : undefined,
      latestAssistantStatus: latestStatusAssistant
        ? truncate(latestStatusAssistant.content, 900)
        : undefined,
      nextRecommendedTask: nextRecommended,
    },
    tasks,
    verification,
    evidence,
    risks: risksAgg,
    filesMentioned: filesAgg,
    repoState,
    references: {
      fullSession: "session.json",
      timeline: "timeline.md",
      commands: "commands.md",
      redactionReport: "redaction-report.md",
    },
  };
}
