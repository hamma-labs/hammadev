import fs from "node:fs";
import fsp from "node:fs/promises";
import readline from "node:readline";

export interface ClaudeShapeReport {
  path: string;
  sizeBytes: number;
  totalLines: number;
  parsedLines: number;
  malformedLines: number;
  topLevelKeyFrequency: Record<string, number>;
  typeCounts: Record<string, number>;
  roleCounts: Record<string, number>;
  shapeByType: Record<string, Record<string, string>>;
  cwdValues: string[];
  projectPathValues: string[];
}

function jsType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function mergeType(existing: string | undefined, next: string): string {
  if (!existing) return next;
  if (existing === next) return existing;
  const parts = new Set(existing.split("|"));
  parts.add(next);
  return Array.from(parts).sort().join("|");
}

export async function inspectClaudeShape(
  filePath: string
): Promise<ClaudeShapeReport> {
  const stat = await fsp.stat(filePath);

  const report: ClaudeShapeReport = {
    path: filePath,
    sizeBytes: stat.size,
    totalLines: 0,
    parsedLines: 0,
    malformedLines: 0,
    topLevelKeyFrequency: {},
    typeCounts: {},
    roleCounts: {},
    shapeByType: {},
    cwdValues: [],
    projectPathValues: []
  };

  const cwdSet = new Set<string>();
  const projectPathSet = new Set<string>();

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    report.totalLines += 1;

    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      report.malformedLines += 1;
      continue;
    }

    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      report.malformedLines += 1;
      continue;
    }

    report.parsedLines += 1;

    const typeLabel =
      typeof obj.type === "string" && obj.type.length > 0
        ? obj.type
        : "<no-type>";
    report.typeCounts[typeLabel] = (report.typeCounts[typeLabel] ?? 0) + 1;

    const role =
      typeof obj?.message?.role === "string"
        ? obj.message.role
        : typeof obj?.role === "string"
          ? obj.role
          : undefined;
    if (role) {
      report.roleCounts[role] = (report.roleCounts[role] ?? 0) + 1;
    }

    for (const key of Object.keys(obj)) {
      report.topLevelKeyFrequency[key] =
        (report.topLevelKeyFrequency[key] ?? 0) + 1;
    }

    const shape = (report.shapeByType[typeLabel] ??= {});
    for (const [k, v] of Object.entries(obj)) {
      shape[k] = mergeType(shape[k], jsType(v));
    }

    if (typeof obj.cwd === "string" && obj.cwd.length > 0) {
      cwdSet.add(obj.cwd);
    }
    if (typeof obj.projectPath === "string" && obj.projectPath.length > 0) {
      projectPathSet.add(obj.projectPath);
    }
  }

  report.cwdValues = Array.from(cwdSet).sort();
  report.projectPathValues = Array.from(projectPathSet).sort();

  return report;
}
