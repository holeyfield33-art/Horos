/**
 * Content re-verification gate — SPEC §6.4 (added in v0.1 from adversarial
 * review). Before a selected file is trusted, recompute the SHA-256 of its
 * current on-disk content and compare to the graph node's `content_hash`. Any
 * mismatch — or a file that has since disappeared — aborts with
 * `content drift <path>`, so a receipt never attests to a file whose content no
 * longer matches the graph.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { sha256 } from "../canonical/index.js";
import { ContentDriftError } from "../errors.js";

export type VerifiableFile = {
  readonly path: string;
  readonly content_hash: string;
};

/**
 * Verify every file's current content against its recorded hash. Throws
 * ContentDriftError on the first divergence (iterated in selection order so the
 * reported path is deterministic).
 */
export function verifySelectionContent(
  selection: readonly VerifiableFile[],
  repoRoot: string,
): void {
  const resolvedRoot = resolve(repoRoot);
  for (const file of selection) {
    const full = join(repoRoot, file.path);
    if (!resolve(full).startsWith(resolvedRoot + sep)) {
      throw new ContentDriftError(file.path);
    }
    if (!existsSync(full)) {
      throw new ContentDriftError(file.path);
    }
    const actual = sha256(readFileSync(full));
    if (actual !== file.content_hash) {
      throw new ContentDriftError(file.path);
    }
  }
}
