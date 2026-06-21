/**
 * Repo manifest / `tree_hash` — SPEC §2.3.
 *
 * `git ls-tree -r --name-only <commit>`, tracked files only, sorted by byte
 * order, one path per line, LF-separated (no trailing newline — see
 * DECISIONS.md), UTF-8, SHA-256. The same definition is shared with the graph
 * generator so both agree on "the repository at this commit".
 */

import { execFileSync } from "node:child_process";
import { byteSorted } from "./bytes.js";
import { sha256 } from "./primitives.js";

/** Canonical manifest bytes from a list of tracked paths. */
export function manifestBytes(paths: readonly string[]): Uint8Array {
  const body = byteSorted(paths).join("\n");
  return new TextEncoder().encode(body);
}

/** `tree_hash`: SHA-256 of the canonical manifest. */
export function treeHash(paths: readonly string[]): string {
  return sha256(manifestBytes(paths));
}

/**
 * Read the tracked-file list for a commit from a git repository. The pure
 * functions above define the hash; this is the I/O that feeds them.
 */
export function readRepoManifest(commit: string, cwd?: string): string[] {
  const stdout = execFileSync("git", ["ls-tree", "-r", "--name-only", commit], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split("\n").filter((line) => line.length > 0);
}

/** Convenience: read the manifest for a commit and hash it. */
export function treeHashForCommit(commit: string, cwd?: string): string {
  return treeHash(readRepoManifest(commit, cwd));
}
