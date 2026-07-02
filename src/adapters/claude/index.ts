import { discoverClaudeSessions } from "./discover.js";
import { resolveClaudeTarget } from "./resolve.js";
import { inspectClaudeShape } from "./shape.js";
import { parseClaudeSession } from "./parse.js";

export const ClaudeAdapter = {
  async list(claudeHomes?: string[]) {
    return discoverClaudeSessions(claudeHomes);
  },

  async resolve(target: string, claudeHomes?: string[]) {
    return resolveClaudeTarget(target, { claudeHomes });
  },

  async inspectShape(filePath: string) {
    return inspectClaudeShape(filePath);
  },

  async inspect(filePath: string) {
    return parseClaudeSession(filePath);
  }
};
