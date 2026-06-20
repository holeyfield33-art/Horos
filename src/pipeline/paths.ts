/**
 * Path heuristics for the selection pipeline (entrypoint matching, test/build
 * classification). All deterministic and versioned via entrypoint_rules.version.
 */

export function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

export function dirSegments(path: string): string[] {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return [];
  return path.slice(0, slash).split("/").filter((s) => s.length > 0);
}

/** Filename stem: basename with every extension removed ("a.test.ts" -> "a"). */
export function fileStem(path: string): string {
  const name = basename(path);
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /(^|\/)(__tests__|__test__)\//;
const BUILD_DIR = /(^|\/)(dist|build|out|coverage|\.next|node_modules)\//;

export function isTestPath(path: string): boolean {
  return TEST_FILE.test(basename(path)) || TEST_DIR.test(path);
}

export function isBuildPath(path: string): boolean {
  return BUILD_DIR.test(path);
}

/** For a test file, its subject stem ("auth/jwt.test.ts" -> "jwt"). */
export function testSubjectStem(path: string): string {
  return fileStem(path);
}

/** Round a score to stabilize float products for deterministic ranking. */
export function stabilizeScore(score: number): number {
  return Math.round(score * 1e6) / 1e6;
}
