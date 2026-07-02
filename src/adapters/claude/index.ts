import { discoverClaudeSessions } from "./discover.js";

export const ClaudeAdapter = {
  async list(claudeHomes?: string[]) {
    return discoverClaudeSessions(claudeHomes);
  }
};
