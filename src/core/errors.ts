export type ErrorCategory =
  | "CLI_ERROR"
  | "SESSION_ERROR"
  | "HANDOFF_ERROR"
  | "PROJECT_ERROR"
  | "HISTORY_ERROR"
  | "ENVIRONMENT_ERROR"
  | "INSTALL_ERROR";

const TROUBLESHOOTING_BASE_URL =
  "https://github.com/xayrullonematov/hammadev/blob/main/docs/troubleshooting.md";

export function troubleshootingUrl(category: ErrorCategory): string {
  return `${TROUBLESHOOTING_BASE_URL}#${category.toLowerCase()}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

export function formatCliError(category: ErrorCategory, error: unknown): string {
  return `[${category}] ${errorMessage(error)}\nTroubleshooting: ${troubleshootingUrl(category)}`;
}
