import { discoverCodexSessions } from "./discover.js";
import { parseCodexRollout } from "./rollout.js";
import { resolveCodexTarget } from "./resolve.js";

export const CodexAdapter = {
  async list() {
    return discoverCodexSessions();
  },

  async latest() {
    const sessions = await discoverCodexSessions();
    return sessions[0] ?? null;
  },

  async resolve(target: string, codexHome?: string) {
    return resolveCodexTarget(target, { codexHome });
  },

  async inspect(sessionPath: string) {
    return parseCodexRollout(sessionPath);
  }
};
