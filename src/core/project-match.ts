import fs from "node:fs/promises";
import path from "node:path";

/**
 * Resolve a path to its canonical form, falling back to the resolved (but not
 * necessarily existing) path when realpath fails.
 */
export async function canonicalPath(value: string): Promise<string> {
  const resolved = path.resolve(value);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

/**
 * True when `candidatePath` is the project root or lives inside it.
 */
export function belongsToProject(
  projectPath: string,
  candidatePath: string
): boolean {
  if (projectPath === candidatePath) return true;
  const relative = path.relative(projectPath, candidatePath);
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

export interface ProjectSessionRef {
  projectPathHint?: string;
}

/**
 * Filter discovered sessions to those whose recorded cwd belongs to the
 * requested project. Returns the canonicalized project path alongside matches.
 */
export async function filterSessionsByProject<T extends ProjectSessionRef>(
  sessions: T[],
  projectPath: string
): Promise<{ requestedProject: string; matches: T[] }> {
  const requestedProject = await canonicalPath(projectPath);
  const matches: T[] = [];
  for (const session of sessions) {
    if (!session.projectPathHint) continue;
    const sessionProject = await canonicalPath(session.projectPathHint);
    if (belongsToProject(requestedProject, sessionProject)) {
      matches.push(session);
    }
  }
  return { requestedProject, matches };
}
