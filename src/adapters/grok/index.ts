import { discoverGrokSessions, GrokSessionRef } from "./discover.js";
import { parseGrokSession } from "./parse.js";
import { resolveGrokTarget, listGrokProjectCandidates } from "./resolve.js";
import { defaultGrokHome } from "./paths.js";

export interface GrokAdapterOptions {
  grokHome?: string;
  projectPath?: string;
}

export const GrokAdapter = {
  async list(grokHome?: string) {
    return discoverGrokSessions(grokHome);
  },

  async listProject(projectPath: string, grokHome?: string) {
    return listGrokProjectCandidates(projectPath, grokHome);
  },

  async resolve(target: string, options: GrokAdapterOptions = {}) {
    return resolveGrokTarget(target, {
      grokHome: options.grokHome,
      projectPath: options.projectPath,
    });
  },

  async inspect(sessionIdOrDir: string, grokHome?: string) {
    return parseGrokSession(sessionIdOrDir, grokHome);
  },

  async parse(sessionIdOrDir: string, grokHome?: string) {
    return parseGrokSession(sessionIdOrDir, grokHome);
  },
};

export { discoverGrokSessions } from "./discover.js";
export { parseGrokSession } from "./parse.js";
export { defaultGrokHome } from "./paths.js";
