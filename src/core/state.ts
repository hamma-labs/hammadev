import { HammaMessage, HammaSession } from "./schema.js";

export const HANDOFF_SCHEMA_VERSION = 1 as const;

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
  warnings: string[];
}

export interface HammaTaskState {
  schemaVersion: typeof HANDOFF_SCHEMA_VERSION;
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
  risks: string[];
  filesMentioned: string[];
  repoState: HammaRepoState;
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
];

const REMAINING_PATTERNS: RegExp[] = [
  /Next is task #?(\d+)(?::\s*([^\n.]+))?/gi,
  /Remaining[^\n.]*task #?(\d+)(?::\s*([^\n.]+))?/gi,
  /task #?(\d+)\s+remains/gi,
];

const LATEST_STATUS_MARKER =
  /\b(?:task #?\d+ (?:completed|fixed)|fixed finding #?\d+|completed|passes|remaining|next is task)\b/i;

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

export function isImportantUserMessage(content: string): boolean {
  return IMPORTANT_USER_WORDS.test(content);
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

function buildTitleRegistry(assistants: HammaMessage[]): Map<string, string> {
  const candidates = new Map<string, TitleCandidate[]>();
  let order = 0;
  const add = (id: string, rawTitle: string, priority: number) => {
    const title = cleanTitle(rawTitle);
    if (title.length < 5 || title.length > 220) return;
    const arr = candidates.get(id) ?? [];
    arr.push({ title, priority, order: order++ });
    candidates.set(id, arr);
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

  for (const msg of assistants) {
    for (const { re, priority } of introPatterns) {
      for (const m of msg.content.matchAll(re)) {
        add(m[1], m[2], priority);
      }
    }
    for (const item of extractPlanItems(msg.content)) {
      add(item.id, item.title, 1);
    }
  }

  const registry = new Map<string, string>();
  for (const [id, list] of candidates) {
    list.sort((a, b) => b.priority - a.priority || b.order - a.order);
    registry.set(id, list[0].title);
  }
  return registry;
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

function categorizeVerification(session: HammaSession): string[] {
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

  for (const msg of session.messages) {
    if (msg.role !== "assistant") continue;
    for (const rawLine of msg.content.split(/\n/)) {
      const line = rawLine.replace(/^[\s>*\-–—•]+/, "").trim();
      if (!line) continue;
      for (let i = 0; i < VERIFICATION_CATEGORIES.length; i++) {
        const cat = VERIFICATION_CATEGORIES[i];
        if (cat.patterns.some((p) => p.test(line))) {
          buckets[i].count += 1;
          if (cat.name === "Tests") {
            const nm = line.match(/(\d+)\/(\d+)/);
            if (nm) buckets[i].lastNumericSample = `${nm[1]}/${nm[2]}`;
          }
          break;
        }
      }
    }
  }

  const results: string[] = [];
  for (const b of buckets) {
    if (b.count === 0) continue;
    if (b.name === "Tests" && b.lastNumericSample) {
      results.push(`Tests: ${b.lastNumericSample} pass (${b.count} confirmation${b.count === 1 ? "" : "s"})`);
    } else {
      results.push(`${b.name}: ${b.verb} (${b.count} confirmation${b.count === 1 ? "" : "s"})`);
    }
  }
  return results;
}

function collectFileMentions(messages: HammaMessage[]): string[] {
  const files = new Set<string>();
  for (const msg of messages) {
    for (const p of extractFilePaths(msg.content)) files.add(p);
  }
  return Array.from(files);
}

function collectRisks(messages: HammaMessage[]): string[] {
  const raw: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue;
    for (const clause of splitClauses(msg.content)) {
      if (isActionableRisk(clause)) {
        raw.push(truncate(clause, 240));
      }
    }
  }
  return dedupRisks(raw);
}

export function extractTaskState(
  session: HammaSession,
  options: {
    targetCli: string;
    repoState: HammaRepoState;
  }
): HammaTaskState {
  const { targetCli, repoState } = options;

  const messages = session.messages.filter((m) => m.role !== "system");
  const users = messages.filter((m) => m.role === "user");
  const assistants = messages.filter((m) => m.role === "assistant");

  const importantUsers = users.filter((u) => isImportantUserMessage(u.content));
  const firstUser = users[0];
  const goalUser =
    firstUser && firstUser.content.trim().length >= 20 ? firstUser : importantUsers[0] ?? firstUser;
  const latestImportantUser = importantUsers[importantUsers.length - 1] ?? users[users.length - 1];

  const latestStatusAssistant =
    [...assistants].reverse().find((a) => LATEST_STATUS_MARKER.test(a.content)) ??
    assistants[assistants.length - 1];

  const titleRegistry = buildTitleRegistry(assistants);

  const tasksById = new Map<string, HammaTaskLedgerItem>();

  for (const msg of assistants) {
    for (const pat of COMPLETED_PATTERNS) {
      for (const mm of msg.content.matchAll(pat)) {
        const id = mm[1];
        const files = extractFilePaths(msg.content);
        const existing = tasksById.get(id);
        const summary = firstParagraph(msg.content, 400);
        tasksById.set(id, {
          id,
          title: titleRegistry.get(id) ?? existing?.title,
          status: "completed",
          summary: existing?.status === "completed" && existing.summary ? existing.summary : summary,
          evidence: mergeUnique(existing?.evidence ?? [], msg.timestamp ? [msg.timestamp] : []),
          risks: existing?.risks ?? [],
          filesMentioned: mergeUnique(existing?.filesMentioned ?? [], files),
        });
      }
    }

    for (const pat of REMAINING_PATTERNS) {
      for (const mm of msg.content.matchAll(pat)) {
        const id = mm[1];
        const existing = tasksById.get(id);
        if (existing && existing.status === "completed") continue;
        const files = extractFilePaths(msg.content);
        tasksById.set(id, {
          id,
          title: titleRegistry.get(id) ?? existing?.title,
          status: "remaining",
          summary: existing?.summary || firstParagraph(msg.content, 300),
          evidence: mergeUnique(existing?.evidence ?? [], msg.timestamp ? [msg.timestamp] : []),
          risks: existing?.risks ?? [],
          filesMentioned: mergeUnique(existing?.filesMentioned ?? [], files),
        });
      }
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

  const tasks = Array.from(tasksById.values()).sort((a, b) => {
    const na = Number(a.id ?? 0);
    const nb = Number(b.id ?? 0);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return 0;
  });

  const verification = categorizeVerification(session);
  const risksAgg = collectRisks(messages);
  const filesAgg = collectFileMentions(messages);

  const remainingTasks = tasks.filter((t) => t.status === "remaining");
  let nextRecommended: string | undefined;
  if (remainingTasks.length > 0) {
    const t = remainingTasks[0];
    const label = t.title ?? t.summary;
    nextRecommended = `Task #${t.id}: ${truncate(label, 220)}`;
  } else if (latestImportantUser) {
    nextRecommended = truncate(latestImportantUser.content, 240);
  }

  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
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
