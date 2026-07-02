import fs from "node:fs";
import readline from "node:readline";
import { HammaSession } from "../../core/schema.js";
import { redactText } from "../../core/redact.js";
import { parseRolloutFilename } from "./paths.js";

function stringifySafe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractContentText(content: unknown): string | undefined {
  if (!content) return undefined;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    const parts = content
      .map((item: any) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .filter(Boolean);

    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  if (typeof content === "object") {
    const obj: any = content;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.message === "string") return obj.message;
  }

  return undefined;
}

function extractPayloadText(payload: any): string | undefined {
  if (!payload) return undefined;

  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.content === "string") return payload.content;

  const fromContent = extractContentText(payload.content);
  if (fromContent) return fromContent;

  return undefined;
}

function redactIntoSession(session: HammaSession, text: string): string {
  const redacted = redactText(text);
  session.security.redactionCount += redacted.count;
  if (redacted.count > 0) session.security.redacted = true;
  return redacted.text;
}

export async function parseCodexRollout(rolloutPath: string): Promise<HammaSession> {
  try {
    await fs.promises.access(rolloutPath, fs.constants.R_OK);
  } catch (err: any) {
    throw new Error(`Rollout file is missing or not readable: ${rolloutPath}`);
  }

  const parsedFile = parseRolloutFilename(rolloutPath);

  const session: HammaSession = {
    meta: {
      sourceCli: "codex",
      sourceSessionId: parsedFile?.conversationId ?? "",
      startedAt: parsedFile?.startedAt,
      sourcePath: rolloutPath
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

  const fileStream = fs.createReadStream(rolloutPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const toolCalls = new Map<string, { name: string; input?: unknown }>();

  for await (const line of rl) {
    if (!line.trim()) continue;

    let item: any;
    try {
      item = JSON.parse(line);
    } catch {
      session.parserWarnings.push("Skipped malformed JSONL line.");
      continue;
    }

    const topType = String(item.type ?? "");
    const payload = item.payload ?? {};
    const payloadType = String(payload.type ?? "");
    const timestamp = item.timestamp ? String(item.timestamp) : undefined;

    // session_meta line
    if (topType === "session_meta") {
      const id = payload.session_id ?? payload.id;
      const cwd = payload.cwd;
      if (id && !session.meta.sourceSessionId) session.meta.sourceSessionId = String(id);
      if (cwd) session.meta.projectPath = String(cwd);
      if (payload.timestamp && !session.meta.startedAt) {
        session.meta.startedAt = String(payload.timestamp);
      }
      continue;
    }

    // turn_context contains cwd/model/git-ish context
    if (topType === "turn_context") {
      if (payload.cwd) session.meta.projectPath = String(payload.cwd);
      continue;
    }

    // event_msg: user visible events
    if (topType === "event_msg") {
      if (payloadType === "user_message") {
        const raw = extractPayloadText(payload);
        if (raw) {
          session.messages.push({
            role: "user",
            content: redactIntoSession(session, raw),
            timestamp
          });
        }
        continue;
      }

      if (payloadType === "agent_message") {
        const raw = extractPayloadText(payload);
        if (raw) {
          session.messages.push({
            role: "assistant",
            content: redactIntoSession(session, raw),
            timestamp
          });
        }
        continue;
      }

      // Some command/tool completions may appear here.
      if (payloadType === "mcp_tool_call_end") {
        const invocation = payload.invocation;
        const result = payload.result;
        const command =
          invocation?.arguments?.cmd ??
          invocation?.arguments?.command ??
          invocation?.input?.cmd ??
          invocation?.input?.command;

        if (command) {
          session.shellCommands.push({
            command: redactIntoSession(session, stringifySafe(command)),
            output: result ? redactIntoSession(session, stringifySafe(result)) : undefined,
            endedAt: timestamp
          });
        }
        continue;
      }

      continue;
    }

    // response_item: model/tool transcript items
    if (topType === "response_item") {
      if (payloadType === "function_call" || payloadType === "custom_tool_call") {
        const callId = payload.call_id;
        const name = payload.name ?? "tool_call";
        if (callId) {
          toolCalls.set(String(callId), {
            name: String(name),
            input: payload.arguments ?? payload.input
          });
        }

        // Shell commands are often represented as custom tool calls.
        const input = payload.arguments ?? payload.input;
        const possibleCommand =
          input?.cmd ??
          input?.command ??
          input?.argv?.join?.(" ") ??
          (name === "shell" || name === "exec" || name === "bash" ? input : undefined);

        if (possibleCommand) {
          session.shellCommands.push({
            command: redactIntoSession(session, stringifySafe(possibleCommand)),
            startedAt: timestamp
          });
        }

        continue;
      }

      if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
        const rawOutput = payload.output;
        if (rawOutput !== undefined) {
          const output = redactIntoSession(session, stringifySafe(rawOutput));

          // Attach to latest shell command if possible.
          const last = session.shellCommands[session.shellCommands.length - 1];
          if (last && !last.output) {
            last.output = output;
            last.endedAt = timestamp;
          }
        }
        continue;
      }

      // Ignore reasoning/token_count for v0.1.
      continue;
    }
  }

  session.meta.lastUpdatedAt = new Date().toISOString();

  return session;
}
