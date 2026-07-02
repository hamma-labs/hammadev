import fs from "node:fs";
import fsp from "node:fs/promises";
import readline from "node:readline";
import { HammaSession } from "../../core/schema.js";
import { redactText } from "../../core/redact.js";
import { sessionIdFromFilename } from "./paths.js";

const IGNORED_TOP_TYPES = new Set([
  "system",
  "permission-mode",
  "mode",
  "file-history-snapshot",
  "ai-title",
  "last-prompt",
  "attachment"
]);

function extractText(message: any): string | undefined {
  if (!message) return undefined;

  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const parts: string[] = [];
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
      // Deliberately skip: thinking, tool_use, tool_result, image, etc.
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  return undefined;
}

function redactInto(session: HammaSession, text: string): string {
  const r = redactText(text);
  session.security.redactionCount += r.count;
  if (r.count > 0) session.security.redacted = true;
  return r.text;
}

export async function parseClaudeSession(sessionPath: string): Promise<HammaSession> {
  try {
    await fsp.access(sessionPath, fs.constants.R_OK);
  } catch {
    throw new Error(`Claude session file is missing or not readable: ${sessionPath}`);
  }

  const session: HammaSession = {
    meta: {
      sourceCli: "claude",
      sourceSessionId: sessionIdFromFilename(sessionPath) ?? "",
      sourcePath: sessionPath
    },
    messages: [],
    shellCommands: [],
    parserWarnings: [],
    security: {
      redacted: false,
      redactionCount: 0,
      warnings: []
    }
  };

  const stream = fs.createReadStream(sessionPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let earliestTs: string | undefined;
  let latestTs: string | undefined;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      session.parserWarnings.push("Skipped malformed JSONL line.");
      continue;
    }

    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      session.parserWarnings.push("Skipped non-object JSONL line.");
      continue;
    }

    const type = typeof obj.type === "string" ? obj.type : "";

    if (IGNORED_TOP_TYPES.has(type)) continue;

    // Seed session id / project path from any record that carries them.
    if (!session.meta.sourceSessionId && typeof obj.sessionId === "string") {
      session.meta.sourceSessionId = obj.sessionId;
    }
    if (!session.meta.projectPath && typeof obj.cwd === "string") {
      session.meta.projectPath = obj.cwd;
    }
    if (!session.meta.projectPath && typeof obj.projectPath === "string") {
      session.meta.projectPath = obj.projectPath;
    }

    const timestamp =
      typeof obj.timestamp === "string" ? obj.timestamp : undefined;
    if (timestamp) {
      if (!earliestTs || timestamp < earliestTs) earliestTs = timestamp;
      if (!latestTs || timestamp > latestTs) latestTs = timestamp;
    }

    if (type === "user" && obj.message?.role === "user") {
      const raw = extractText(obj.message);
      if (raw && raw.trim().length > 0) {
        session.messages.push({
          role: "user",
          content: redactInto(session, raw),
          timestamp
        });
      }
      continue;
    }

    if (type === "assistant" && obj.message?.role === "assistant") {
      const raw = extractText(obj.message);
      if (raw && raw.trim().length > 0) {
        session.messages.push({
          role: "assistant",
          content: redactInto(session, raw),
          timestamp
        });
      }
      continue;
    }
  }

  if (earliestTs) session.meta.startedAt = earliestTs;
  session.meta.lastUpdatedAt = latestTs ?? new Date().toISOString();

  return session;
}
