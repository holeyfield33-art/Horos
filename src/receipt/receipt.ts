/**
 * Receipt assembly, hashing, and signing — SPEC §5.
 *
 * receipt_hash = sha256(cjson(payload excluding receipt_hash and signature)).
 * The Ed25519 signature is computed over those same canonical bytes, so the
 * signature and the hash commit to identical content. timestamp and task_id are
 * recorded in the payload; a verifier reuses them from the receipt (they are not
 * regenerated), which is how replay reproduces an identical receipt_hash (§5.3).
 */

import { randomUUID, type KeyObject } from "node:crypto";

import {
  byteSorted,
  cjson,
  canonicalReceiptPayload,
  ed25519PublicKeyFromHex,
  ed25519PublicKeyFromPrivate,
  ed25519PublicKeyToHex,
  ed25519Sign,
  ed25519Verify,
  manualIncludeHash,
  sha256,
  taskHash,
  type CanonicalObject,
} from "../canonical/index.js";
import {
  computeSelectorConfigHash,
  computeWeightPolicyHash,
  type SelectorConfig,
} from "../config/index.js";
import { isTaskClass, type TaskClass } from "../enums.js";
import { SchemaValidationError } from "../errors.js";
import type { SelectionResult } from "../pipeline/index.js";
import type { Receipt, ChainLink } from "./types.js";

export type BuildReceiptInput = {
  readonly selectionResult: SelectionResult;
  readonly repository: { readonly origin: string; readonly commit_sha: string; readonly tree_hash: string };
  readonly taskText: string;
  readonly taskClass: TaskClass;
  readonly config: SelectorConfig;
  readonly graphArtifactHash: string;
  readonly graphGenerator: { readonly name: string; readonly version: string };
  readonly manualInclude: readonly string[];
  readonly prevReceiptHash: string | null;
  readonly privateKey: KeyObject;
  readonly timestamp?: string;
  readonly taskId?: string;
};

/** Everything in a receipt except `receipt_hash` and `signature`. */
type ReceiptPayload = Omit<Receipt, "receipt_hash" | "signature">;

function buildPayload(input: BuildReceiptInput): ReceiptPayload {
  if (!isTaskClass(input.taskClass)) {
    throw new SchemaValidationError(`unknown task_class "${input.taskClass}"`);
  }
  const manual = byteSorted(input.manualInclude);
  return {
    version: "0.1",
    timestamp: input.timestamp ?? new Date().toISOString(),
    task_id: input.taskId ?? randomUUID(),
    repository: {
      origin: input.repository.origin,
      commit_sha: input.repository.commit_sha,
      tree_hash: input.repository.tree_hash,
    },
    task: {
      task_hash: taskHash(input.taskText),
      task_class: input.taskClass,
    },
    selector: {
      version: input.config.version,
      config_hash: computeSelectorConfigHash(input.config),
      weight_policy_hash: computeWeightPolicyHash(input.config),
    },
    graph: {
      graph_artifact_hash: input.graphArtifactHash,
      graph_generator: { name: input.graphGenerator.name, version: input.graphGenerator.version },
      graph_supplied_externally: true,
    },
    manual_include: manual,
    manual_include_hash: manualIncludeHash(manual),
    selection: input.selectionResult.selection,
    exclusions: input.selectionResult.exclusions,
    coverage: input.selectionResult.coverage,
    prev_receipt_hash: input.prevReceiptHash,
  };
}

/** Canonical bytes that both `receipt_hash` and the signature commit to. */
export function receiptSigningBytes(payloadOrReceipt: CanonicalObject): Uint8Array {
  return cjson(canonicalReceiptPayload(payloadOrReceipt));
}

/** Recompute `receipt_hash` from a receipt (or payload), ignoring the stored one. */
export function recomputeReceiptHash(payloadOrReceipt: CanonicalObject): string {
  return sha256(receiptSigningBytes(payloadOrReceipt));
}

/** Assemble, hash, and sign a receipt. */
export function buildReceipt(input: BuildReceiptInput): Receipt {
  const payload = buildPayload(input);
  const bytes = receiptSigningBytes(payload);
  const receiptHash = sha256(bytes);
  const publicKey = ed25519PublicKeyFromPrivate(input.privateKey);
  const signature = {
    algorithm: "Ed25519",
    public_key: ed25519PublicKeyToHex(publicKey),
    value: ed25519Sign(bytes, input.privateKey),
  };
  return { ...payload, receipt_hash: receiptHash, signature };
}

const ED25519_PUBLIC_KEY_HEX = /^[0-9a-f]{64}$/i;
const ED25519_SIGNATURE_HEX = /^[0-9a-f]{128}$/i;

/** Verify a receipt's Ed25519 signature against its own public key. */
export function verifyReceiptSignature(receipt: Receipt): boolean {
  if (receipt.signature.algorithm !== "Ed25519") return false;
  if (!ED25519_PUBLIC_KEY_HEX.test(receipt.signature.public_key)) return false;
  if (!ED25519_SIGNATURE_HEX.test(receipt.signature.value)) return false;
  const key = ed25519PublicKeyFromHex(receipt.signature.public_key);
  return ed25519Verify(receiptSigningBytes(receipt), receipt.signature.value, key);
}

/** Project a receipt down to its thin chain-link object — SPEC §5.1. */
export function toChainLink(receipt: Receipt, chainId: string, seq: number): ChainLink {
  return {
    chain_id: chainId,
    seq,
    prev_receipt_hash: receipt.prev_receipt_hash,
    receipt_hash: receipt.receipt_hash,
    signature: receipt.signature.value,
  };
}
