import { discoverClaudeSessions } from "./discover.js";
import {
  ResolveClaudeOptions,
  listClaudeProjectCandidates,
  resolveClaudeTarget
} from "./resolve.js";
import { inspectClaudeShape } from "./shape.js";
import { parseClaudeSession } from "./parse.js";

export const ClaudeAdapter = {
  async list(claudeHomes?: string[]) {
    return discoverClaudeSessions(claudeHomes);
  },

  async resolve(target: string, options: ResolveClaudeOptions = {}) {
    return resolveClaudeTarget(target, options);
  },

  async listProject(projectPath: string, claudeHomes?: string[]) {
    return listClaudeProjectCandidates(projectPath, claudeHomes);
  },

  async inspectShape(filePath: string) {
    return inspectClaudeShape(filePath);
  },

  async inspect(filePath: string) {
    return parseClaudeSession(filePath);
  }
};
