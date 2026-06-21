/**
 * Horos error taxonomy. Every failure is an explicit, named error — no broad
 * catch-all handling. Gate failures (SPEC §4) carry the exact spec wording so
 * the CLI can surface it verbatim.
 */

export class HorosError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Hard gate (§4): no graph artifact supplied. No receipt may be emitted. */
export class GraphArtifactRequiredError extends HorosError {}

/** Loader/schema validation failure (§4). */
export class SchemaValidationError extends HorosError {}

/** Hard gate (§4): graph `commit_sha` does not match the routed repo HEAD. */
export class CommitMismatchError extends HorosError {}

/** Content re-verification failure (§6.4): a selected file drifted from the graph. */
export class ContentDriftError extends HorosError {
  public readonly path: string;
  public constructor(path: string) {
    super(`content drift ${path}`);
    this.path = path;
  }
}

/** Receipt verification failure (§5.3), with the exact diverging field. */
export class ReceiptVerificationError extends HorosError {
  public readonly field: string;
  public constructor(field: string, detail: string) {
    super(`receipt verification failed at ${field}: ${detail}`);
    this.field = field;
  }
}
