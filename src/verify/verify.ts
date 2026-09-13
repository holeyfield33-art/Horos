/**
 * Receipt replay verification — SPEC §5.3.
 *
 * Given a receipt and the inputs it commits to, re-run selection and assert that
 * everything reproduces: the recorded provenance hashes recompute from the
 * supplied inputs, the selection/exclusions/coverage replay identically, the
 * stored receipt_hash matches its own payload, and the Ed25519 signature
 * verifies. On failure the exact diverging field is reported.
 *
 * Acceptance (§6 build order): no receipt can be produced that this cannot replay
 * — buildReceipt and verifyReceipt share the canonical serializer and pipeline.
 */

import {
  byteSorted,
  cjsonString,
  manualIncludeHash,
  taskHash,
  type CanonicalValue,
} from "../canonical/index.js";
import {
  computeSelectorConfigHash,
  computeWeightPolicyHash,
  type SelectorConfig,
} from "../config/index.js";
import { ContentDriftError, SchemaValidationError } from "../errors.js";
import { loadGraphArtifact } from "../graph/index.js";
import { selectContext, verifySelectionContent } from "../pipeline/index.js";
import { recomputeReceiptHash, verifyReceiptSignature } from "../receipt/index.js";
import type { Receipt } from "../receipt/index.js";
import { validateReceipt } from "../receipt/validate.js";

export type ReplayInputs = {
  /** Parsed graph artifact (validated and hashed during verification). */
  readonly graph: unknown;
  readonly taskText: string;
  readonly config: SelectorConfig;
  readonly manualInclude: readonly string[];
  /** Repo root for content re-verification (§6.4); omit to skip that gate. */
  readonly repoRoot?: string;
  /** Pin the trusted issuer; otherwise verification establishes self-consistency only. */
  readonly expectedPublicKey?: string;
};

export type VerifyOutcome =
  | { readonly pass: true }
  | { readonly pass: false; readonly field: string; readonly detail: string };

const fail = (field: string, detail: string): VerifyOutcome => ({ pass: false, field, detail });

const sameCanonical = (a: CanonicalValue, b: CanonicalValue): boolean =>
  cjsonString(a) === cjsonString(b);

export function verifyReceipt(value: unknown, inputs: ReplayInputs): VerifyOutcome {
  try {
    validateReceipt(value);
    return verifyValidatedReceipt(value, inputs);
  } catch (error) {
    if (error instanceof SchemaValidationError || error instanceof TypeError ||
        (error instanceof Error && error.name === "CanonicalizationError")) {
      return fail("receipt_schema", error.message);
    }
    throw error;
  }
}

function verifyValidatedReceipt(receipt: Receipt, inputs: ReplayInputs): VerifyOutcome {
  // 1. Receipt self-consistency: stored receipt_hash matches its own payload.
  if (recomputeReceiptHash(receipt) !== receipt.receipt_hash) {
    return fail("receipt_hash", "stored receipt_hash does not match the receipt payload");
  }

  // 2. Signature.
  if (!verifyReceiptSignature(receipt)) {
    return fail("signature", "Ed25519 signature does not verify");
  }
  if (inputs.expectedPublicKey !== undefined &&
      receipt.signature.public_key.toLowerCase() !== inputs.expectedPublicKey.toLowerCase()) {
    return fail("signature.public_key", "receipt signer does not match the trusted public key");
  }

  // 3. Provenance inputs recompute to the recorded hashes.
  let loadedHash: string;
  let artifact;
  try {
    const loaded = loadGraphArtifact(inputs.graph);
    loadedHash = loaded.graphArtifactHash;
    artifact = loaded.artifact;
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return fail("graph.graph_artifact_hash", `supplied graph is invalid: ${error.message}`);
    }
    throw error;
  }
  if (loadedHash !== receipt.graph.graph_artifact_hash) {
    return fail("graph.graph_artifact_hash", "supplied graph does not match the recorded hash");
  }
  const provenance = artifact.metadata.provenance;
  for (const [field, expected] of [
    ["origin", provenance.repository_origin],
    ["commit_sha", provenance.commit_sha],
    ["tree_hash", provenance.tree_hash],
  ] as const) {
    if (receipt.repository[field] !== expected) {
      return fail(`repository.${field}`, "receipt provenance differs from the supplied graph");
    }
  }
  for (const field of ["name", "version"] as const) {
    if (receipt.graph.graph_generator[field] !== artifact.metadata.generator[field]) {
      return fail(`graph.graph_generator.${field}`, "receipt generator differs from the supplied graph");
    }
  }
  if (taskHash(inputs.taskText) !== receipt.task.task_hash) {
    return fail("task.task_hash", "supplied task does not match the recorded task_hash");
  }
  if (inputs.config.version !== receipt.selector.version) {
    return fail("selector.version", "supplied selector version differs");
  }
  if (computeSelectorConfigHash(inputs.config) !== receipt.selector.config_hash) {
    return fail("selector.config_hash", "supplied selector config does not match");
  }
  if (computeWeightPolicyHash(inputs.config) !== receipt.selector.weight_policy_hash) {
    return fail("selector.weight_policy_hash", "supplied weight policy does not match");
  }
  const manual = byteSorted(inputs.manualInclude);
  if (!sameCanonical(manual, receipt.manual_include)) {
    return fail("manual_include_hash", "supplied manual includes differ from the receipt list");
  }
  if (manualIncludeHash(manual) !== receipt.manual_include_hash) {
    return fail("manual_include_hash", "supplied manual includes do not match");
  }

  // 4. Re-run selection and compare to the recorded result.
  const result = selectContext({ graph: artifact, task: inputs.taskText, config: inputs.config });
  if (!sameCanonical(result.selection, receipt.selection)) {
    return fail("selection", "replayed selection differs from the recorded selection");
  }
  if (!sameCanonical(result.exclusions, receipt.exclusions)) {
    return fail("exclusions", "replayed exclusions differ from the recorded exclusions");
  }
  if (!sameCanonical(result.coverage, receipt.coverage)) {
    return fail("coverage", "replayed coverage differs from the recorded coverage");
  }

  // 5. Content re-verification (§6.4) when a repo root is supplied.
  if (inputs.repoRoot !== undefined) {
    try {
      verifySelectionContent(receipt.selection, inputs.repoRoot);
    } catch (error) {
      if (error instanceof ContentDriftError) {
        return fail("content", error.message);
      }
      throw error;
    }
  }

  return { pass: true };
}
