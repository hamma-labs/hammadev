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
  /AKIA[0-9A-Z]{16}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /ya29\.[0-9A-Za-z_-]{20,}/g,
  /(api[_-]?key|token|secret|password|auth)\s*[:=]\s*['"]?[^'"\s]+/gi,
  /-----BEGIN [\w ]+?KEY-----[\s\S]*?-----END [\w ]+?KEY-----/g
];

export function redactText(input: string): RedactionResult {
  // One-pass collection: gather all match spans across patterns (no rescans of mutated text)
  const matches: Array<{start: number; end: number}> = [];
  for (const pattern of SECRET_PATTERNS) {
    // ensure global for matchAll style
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length });
      if (!re.global) break;
    }
  }
  if (matches.length === 0) {
    return { text: input, count: 0 };
  }

  // Merge overlapping/adjacent spans so each unique secret occurrence counts once (prevents inflation e.g. glpat + generic)
  matches.sort((a, b) => a.start - b.start);
  const merged: Array<{start: number; end: number}> = [];
  for (const m of matches) {
    if (merged.length === 0 || merged[merged.length - 1].end < m.start) {
      merged.push({ ...m });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, m.end);
    }
  }

  // Build result by slicing from end (single construction pass)
  let text = input;
  for (let i = merged.length - 1; i >= 0; i--) {
    const m = merged[i];
    text = text.slice(0, m.start) + '[REDACTED_SECRET]' + text.slice(m.end);
  }

  return { text, count: merged.length };
}
