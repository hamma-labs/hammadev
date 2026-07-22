export function normalizeSbomLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function sbomTextMatches(existing: string, generated: string): boolean {
  return normalizeSbomLineEndings(existing) === normalizeSbomLineEndings(generated);
}
