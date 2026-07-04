import { discoverCodexSessions } from "./discover.js";
import { parseCodexRollout } from "./rollout.js";
import {
  resolveCodexTarget,
  listCodexProjectCandidates,
  ResolveCodexOptions,
} from "./resolve.js";

export const CodexAdapter = {
  async list() {
    return discoverCodexSessions();
  },

  async listProject(projectPath: string, codexHome?: string) {
    return listCodexProjectCandidates(projectPath, codexHome);
  },

  async latest() {
    const sessions = await discoverCodexSessions();
    return sessions[0] ?? null;
  },

  async resolve(target: string, options: ResolveCodexOptions = {}) {
    return resolveCodexTarget(target, options);
  },

  async inspect(sessionPath: string) {
    return parseCodexRollout(sessionPath);
  }
};
