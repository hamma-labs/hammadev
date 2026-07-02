export interface RedactionResult {
  text: string;
  count: number;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /sk-proj-[A-Za-z0-9_-]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{20,}/g,
  /(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]+/gi
];

export function redactText(input: string): RedactionResult {
  let text = input;
  let count = 0;

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      count += 1;
      return "[REDACTED_SECRET]";
    });
  }

  return { text, count };
}
