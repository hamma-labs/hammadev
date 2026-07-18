import fs from "node:fs/promises";
import path from "node:path";

export interface HandoffHistoryEntry {
  taskId: string;
  sourceAgent: string;
  targetAgent: string;
  createdAt: string;
  handoffPath: string;
  continueFromHere?: string;
}

export interface HandoffRecord {
  taskId: string;
  taskPath: string;
  handoffPath: string;
  markdown: string;
  state?: unknown;
}

const TASK_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z(?:-|$)/;

function timestampFromTaskId(taskId: string): Date | undefined {
  const match = taskId.match(TASK_TIMESTAMP);
  if (!match) return undefined;

  const [, year, month, day, hour, minute, second, millis = "000"] = match;
  const date = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function field(markdown: string, label: string): string | undefined {
  const match = markdown.match(new RegExp(`^- ${label}:\\s*(.+)$`, "mi"));
  return match?.[1]?.trim();
}

function continueFromHere(markdown: string): string | undefined {
  const match = markdown.match(
    /^## Continue from here\s*\n+([\s\S]*?)(?=\n##\s|$)/mi
  );
  if (!match) return undefined;

  const line = match[1]
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return line || undefined;
}

function tasksPath(projectPath: string): string {
  return path.join(path.resolve(projectPath), ".hamma", "tasks");
}

function assertTaskId(taskId: string): void {
  if (
    !taskId ||
    taskId === "." ||
    taskId === ".." ||
    path.basename(taskId) !== taskId ||
    taskId.includes("/") ||
    taskId.includes("\\")
  ) {
    throw new Error(`Invalid handoff task id: ${taskId}`);
  }
}

export async function listHandoffs(
  projectPath: string
): Promise<HandoffHistoryEntry[]> {
  const root = tasksPath(projectPath);
  let entries: import("node:fs").Dirent[];

  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const handoffs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<HandoffHistoryEntry | undefined> => {
        const handoffPath = path.join(root, entry.name, "handoff.md");
        try {
          const [markdown, stats] = await Promise.all([
            fs.readFile(handoffPath, "utf8"),
            fs.stat(path.join(root, entry.name)),
          ]);
          const created = timestampFromTaskId(entry.name) ?? stats.birthtime ?? stats.mtime;

          return {
            taskId: entry.name,
            sourceAgent: field(markdown, "Source CLI") ?? "unknown",
            targetAgent: field(markdown, "Target CLI") ?? "unknown",
            createdAt: created.toISOString(),
            handoffPath,
            continueFromHere: continueFromHere(markdown),
          };
        } catch (error: any) {
          if (error.code === "ENOENT" || error.code === "EISDIR") return undefined;
          throw error;
        }
      })
  );

  return handoffs
    .filter((entry): entry is HandoffHistoryEntry => entry !== undefined)
    .sort((a, b) => {
      const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      return byTime || b.taskId.localeCompare(a.taskId);
    });
}

export async function readHandoff(
  projectPath: string,
  taskId: string
): Promise<string> {
  const resolvedTaskId =
    taskId === "latest"
      ? (await listHandoffs(projectPath))[0]?.taskId
      : taskId;

  if (!resolvedTaskId) {
    throw new Error(`No handoffs found in ${tasksPath(projectPath)}.`);
  }
  assertTaskId(resolvedTaskId);

  const handoffPath = path.join(tasksPath(projectPath), resolvedTaskId, "handoff.md");
  try {
    return await fs.readFile(handoffPath, "utf8");
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(`Handoff '${resolvedTaskId}' was not found in ${tasksPath(projectPath)}.`);
    }
    throw error;
  }
}

export async function readHandoffRecord(
  projectPath: string,
  taskId: string
): Promise<HandoffRecord> {
  const resolvedTaskId =
    taskId === "latest"
      ? (await listHandoffs(projectPath))[0]?.taskId
      : taskId;
  if (!resolvedTaskId) {
    throw new Error(`No handoffs found in ${tasksPath(projectPath)}.`);
  }
  assertTaskId(resolvedTaskId);
  const taskPath = path.join(tasksPath(projectPath), resolvedTaskId);
  const handoffPath = path.join(taskPath, "handoff.md");
  let markdown: string;
  try {
    markdown = await fs.readFile(handoffPath, "utf8");
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Handoff '${resolvedTaskId}' was not found in ${tasksPath(projectPath)}.`
      );
    }
    throw error;
  }

  let state: unknown;
  try {
    state = JSON.parse(
      await fs.readFile(path.join(taskPath, "state.json"), "utf8")
    );
  } catch (error: any) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  return { taskId: resolvedTaskId, taskPath, handoffPath, markdown, state };
}

export function formatHandoffLog(entries: HandoffHistoryEntry[]): string {
  return entries
    .map((entry) => {
      const lines = [
        `Task: ${entry.taskId}`,
        `  Source agent: ${entry.sourceAgent}`,
        `  Target agent: ${entry.targetAgent}`,
        `  Created: ${entry.createdAt}`,
        `  Handoff: ${entry.handoffPath}`,
      ];
      if (entry.continueFromHere) {
        lines.push(`  Continue from here: ${entry.continueFromHere}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
