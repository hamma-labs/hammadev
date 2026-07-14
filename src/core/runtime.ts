export const MIN_NODE_VERSION = "22.12.0";

function versionParts(value: string): [number, number, number] | undefined {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNodeVersionSupported(version: string): boolean {
  const actual = versionParts(version);
  const minimum = versionParts(MIN_NODE_VERSION)!;
  if (!actual) return false;

  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}
