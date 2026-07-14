export function normalizeFilesMentioned(paths: string[]): string[] {
  // dedup by basename (case-insensitive), prefer paths containing /src/
  const byBase = new Map<string, string>();
  for (const p of paths) {
    if (!p || typeof p !== 'string') continue;
    const base = p.split('/').pop()!.toLowerCase();
    const current = byBase.get(base);
    const prefers = p.toLowerCase().includes('/src/');
    const currentPrefers = current ? current.toLowerCase().includes('/src/') : false;
    if (!current || (prefers && !currentPrefers) || (prefers === currentPrefers && p.length > current.length)) {
      byBase.set(base, p);
    }
  }

  let result = Array.from(byBase.values());

  // drop artifact noise unless the path itself is under /src/
  const artifactBases = [
    'session.json',
    'handoff.md',
    'state.json',
    'timeline.md',
    'commands.md',
    'redaction-report.md',
    'readme',
    'readme.md',
    'troubleshooting.md',
    'doctor.ts',
    'quickstart.ts',
    'ci.yml',
    'package.json'
  ];
  const artifactPatterns = [
    /\/(\.github|examples|docs)\//i
  ];

  result = result.filter((p) => {
    const low = p.toLowerCase();
    const base = low.split('/').pop() || '';
    const isArtifactBase = artifactBases.includes(base);
    const isArtifactDir = artifactPatterns.some(re => re.test(low));
    const isSrc = low.includes('/src/');
    if ((isArtifactBase || isArtifactDir) && !isSrc) {
      return false;
    }
    return true;
  });

  // prefer /src/ first, then sort by length desc for specificity
  result.sort((a, b) => {
    const sa = a.toLowerCase().includes('/src/') ? 0 : 1;
    const sb = b.toLowerCase().includes('/src/') ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return b.length - a.length;
  });

  return result;
}
