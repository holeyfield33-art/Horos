/**
 * Horos canonical forms — SPEC §2.
 *
 * The single source of canonical bytes and hashes for every value Horos signs
 * over. Nothing in the router may hash an input except through this module.
 */

export {
  cjson,
  cjsonString,
  compareCodePoints,
  CanonicalizationError,
  type CanonicalObject,
  type CanonicalPrimitive,
  type CanonicalValue,
} from "./cjson.js";

export {
  sha256,
  generateEd25519KeyPair,
  ed25519PrivateKeyFromSeed,
  ed25519PublicKeyFromPrivate,
  ed25519PublicKeyFromHex,
  ed25519PublicKeyToHex,
  ed25519Sign,
  ed25519Verify,
  type Ed25519KeyPair,
} from "./primitives.js";

export { compareUtf8Bytes, byteSorted } from "./bytes.js";

export {
  normalizeTaskTokens,
  taskCanonicalBytes,
  taskHash,
  TASK_NORMALIZATION_POLICY,
  STOPWORD_LIST_VERSION,
  TOKENIZATION_RULE,
} from "./task.js";

export {
  manifestBytes,
  treeHash,
  readRepoManifest,
  treeHashForCommit,
} from "./manifest.js";

export { manualIncludeBytes, manualIncludeHash } from "./manual-includes.js";

export {
  selectorConfigHash,
  weightPolicyHash,
  graphArtifactHash,
  canonicalReceiptPayload,
  receiptPayloadHash,
} from "./hashes.js";
