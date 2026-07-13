import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import fg from "fast-glob";
import { HammaSession, HammaShellCommand } from "../../core/schema.js";
import { redactText } from "../../core/redact.js";
import { defaultGrokHome, grokSessionsRoot } from "./paths.js";
import { MAX_SESSION_BYTES } from "../../core/session-limits.js";

// Use the imported MAX for chat transcript cap (was imported but unused -- bug fix)

function redactInto(session: HammaSession, text: string): string {
  const r = redactText(text);
  session.security.redactionCount += r.count;
  if (r.count > 0) session.security.redacted = true;
  return r.text;
}

function extractTextFromContent(content: unknown): string | undefined {
  if (!content) return undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((c: any) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          if (typeof c.text === "string") return c.text;
          if (typeof c.content === "string") return c.content;
        }
        return "";
      })
      .filter(Boolean);
    return parts.length ? parts.join("\n") : undefined;
  }
  if (typeof content === "object") {
    const c: any = content;
    if (typeof c.text === "string") return c.text;
    if (typeof c.content === "string") return c.content;
  }
  return undefined;
}

export async function findSessionDir(
  sessionId: string,
  grokHome?: string
): Promise<string> {
  const root = grokSessionsRoot(grokHome ?? defaultGrokHome());
  // Find the summary.json whose parent dir name matches the id (or whose summary.info.id matches)
  const pattern = path.join(root, "**", "summary.json");
  let matches: string[] = [];
  try {
    matches = await fg(pattern, { onlyFiles: true, absolute: true });
  } catch {
    // ignore
  }

  for (const p of matches) {
    const dir = path.dirname(p);
    if (path.basename(dir) === sessionId) {
      return dir;
    }
    // also check inside the summary for id match (in case of dir name slug)
    try {
      const raw = await fsp.readFile(p, "utf8");
      const s = JSON.parse(raw);
      if (s?.info?.id === sessionId) return dir;
    } catch {
      // continue
    }
  }

  // fallback: last component match anywhere
  const fallback = matches.find((p) => path.basename(path.dirname(p)) === sessionId);
  if (fallback) return path.dirname(fallback);

  throw new Error(`Grok session directory not found for id ${sessionId}`);
}

export async function parseGrokSession(
  sessionIdOrDir: string,
  grokHome?: string
): Promise<HammaSession> {
  // Accept either a bare sessionId or a direct session directory path.
  let sessionDir: string;
  let id = sessionIdOrDir;

  try {
    const st = await fsp.stat(sessionIdOrDir);
    if (st.isDirectory()) {
      sessionDir = sessionIdOrDir;
      // try to read id from summary
      const sumPath = path.join(sessionDir, "summary.json");
      try {
        const s = JSON.parse(await fsp.readFile(sumPath, "utf8"));
        if (s?.info?.id) id = s.info.id;
      } catch {}
    } else {
      sessionDir = await findSessionDir(sessionIdOrDir, grokHome);
    }
  } catch {
    sessionDir = await findSessionDir(sessionIdOrDir, grokHome);
  }

  const summaryPath = path.join(sessionDir, "summary.json");
  const chatPath = path.join(sessionDir, "chat_history.jsonl");

  // Enforce size limit on the primary transcript (chat_history.jsonl) for grok,
  // analogous to validate for claude/codex. Prevents DoS via huge sessions.
  try {
    const chatStat = await fsp.stat(chatPath);
    if (chatStat.size > MAX_SESSION_BYTES) {
      throw new Error(`Grok chat_history.jsonl exceeds the 50 MiB limit (${chatStat.size} bytes).`);
    }
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }

  const session: HammaSession = {
    meta: {
      sourceCli: "grok",
      sourceSessionId: id,
      sourcePath: sessionDir,
    },
    messages: [],
    shellCommands: [],
    parserWarnings: [],
    security: {
      redacted: false,
      redactionCount: 0,
      warnings: [],
    },
  };

  // Load summary for meta
  try {
    const rawSum = await fsp.readFile(summaryPath, "utf8");
    const sum = JSON.parse(rawSum);
    if (sum?.info?.cwd) session.meta.projectPath = sum.info.cwd;
    if (sum?.generated_title || sum?.session_summary) {
      session.meta.title = sum.generated_title || sum.session_summary;
    }
    if (sum?.created_at) session.meta.startedAt = sum.created_at;
    if (sum?.updated_at || sum?.last_active_at) {
      session.meta.lastUpdatedAt = sum.updated_at || sum.last_active_at;
    }
  } catch (e: any) {
    session.parserWarnings.push(`Could not read summary.json: ${e?.message ?? e}`);
  }

  // Prefer chat_history.jsonl for the transcript (raw chat sent to model)
  let chatExists = false;
  try {
    await fsp.access(chatPath, fs.constants.R_OK);
    chatExists = true;
  } catch {
    session.parserWarnings.push("chat_history.jsonl not readable; transcript may be empty.");
  }

  // Map tool_call id -> info for pairing results to shell commands
  const pendingToolCalls = new Map<
    string,
    { name: string; args?: any; startedAt?: string }
  >();

  if (chatExists) {
    const stream = fs.createReadStream(chatPath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        session.parserWarnings.push("Skipped malformed line in chat_history.jsonl");
        continue;
      }

      const ts = typeof entry?.ts === "string" ? entry.ts : undefined;

      if (entry.type === "user") {
        const text = extractTextFromContent(entry.content);
        if (text && text.trim().length > 0) {
          session.messages.push({
            role: "user",
            content: redactInto(session, text),
            timestamp: ts,
          });
        }
        continue;
      }

      if (entry.type === "assistant") {
        const text = typeof entry.content === "string" ? entry.content : extractTextFromContent(entry.content);
        if (text && text.trim().length > 0) {
          session.messages.push({
            role: "assistant",
            content: redactInto(session, text),
            timestamp: ts,
          });
        }

        // Record tool calls. We especially care about terminal execution for shellCommands.
        const tcs: any[] = Array.isArray(entry.tool_calls) ? entry.tool_calls : [];
        for (const tc of tcs) {
          if (!tc || !tc.id) continue;
          let args: any = undefined;
          if (typeof tc.arguments === "string") {
            try {
              args = JSON.parse(tc.arguments);
            } catch {
              args = tc.arguments;
            }
          } else {
            args = tc.arguments;
          }
          pendingToolCalls.set(tc.id, {
            name: tc.name || "unknown",
            args,
            startedAt: ts,
          });

          // If this is an explicit terminal command, seed a shellCommand early.
          if ((tc.name === "run_terminal_command" || tc.name === "terminal") && args?.command) {
            const cmdStr = typeof args.command === "string" ? args.command : JSON.stringify(args.command);
            session.shellCommands.push({
              command: redactInto(session, cmdStr),
              startedAt: ts,
            });
          }
        }
        continue;
      }

      if (entry.type === "tool_result") {
        const callId = entry.tool_call_id as string | undefined;
        const contentText = extractTextFromContent(entry.content) ?? (typeof entry.content === "string" ? entry.content : undefined);
        if (callId && pendingToolCalls.has(callId)) {
          const info = pendingToolCalls.get(callId)!;
          if (info.name === "run_terminal_command" || info.name === "terminal") {
            // Attach output to the most recent matching shell command that lacks output.
            const last = [...session.shellCommands].reverse().find(
              (sc) => !sc.output && sc.command
            );
            if (last && contentText) {
              last.output = redactInto(session, contentText);
              if (ts) last.endedAt = ts;
            } else if (contentText) {
              // create a minimal record if we missed the call
              session.shellCommands.push({
                command: redactInto(session, info.args?.command || "(terminal)"),
                output: redactInto(session, contentText),
                startedAt: info.startedAt,
                endedAt: ts,
              });
            }
          }
          pendingToolCalls.delete(callId);
        }
        continue;
      }

      // ignore system, reasoning, etc. for the handoff transcript
    }
  }

  // Best-effort: also scan terminal/*.log files for additional command outputs.
  // Filenames contain the call id; content is usually the stdout/stderr of the cmd.
  try {
    const termDir = path.join(sessionDir, "terminal");
    const logs = await fg(path.join(termDir, "call-*.log"), { onlyFiles: true });
    for (const logPath of logs.slice(0, 50)) { // cap to avoid huge sessions
      try {
        const out = await fsp.readFile(logPath, "utf8");
        if (!out.trim()) continue;
        // Extract id-ish from filename for matching if needed; otherwise append as generic
        // We attach only if we see a recent shellCommand without output.
        const last = session.shellCommands[session.shellCommands.length - 1];
        if (last && !last.output) {
          last.output = redactInto(session, out);
        } else {
          // record a generic captured execution (rarely needed)
          session.shellCommands.push({
            command: "(captured terminal output)",
            output: redactInto(session, out.slice(0, 2000)),
          });
        }
      } catch {
        // ignore individual log
      }
    }
  } catch {
    // no terminal dir or glob issue — ok
  }

  if (!session.meta.lastUpdatedAt) {
    session.meta.lastUpdatedAt = new Date().toISOString();
  }

  // Attach source-specific extraction hints from the adapter (keeps heuristic
  // knowledge out of core per AC2 / hybrid sweet spot). Callers (createHandoff etc)
  // automatically benefit because extractTaskState reads session.extractionHints.
  session.extractionHints = {
    // Only the non-overlapping proof pattern (per strategist rec to avoid default overlap).
    // Real grok tuning can be added as separate documented patterns without sharing keywords.
    completedPatterns: [
      /HammaGrokHintProof #?(\d+).*?marker-phase-only/gi
    ],
  };

  return session;
}
