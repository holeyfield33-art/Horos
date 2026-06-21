/**
 * One-off generator for the frozen canonical-form test vectors.
 *
 * Run with: npx tsx scripts/generate-vectors.ts
 *
 * It computes the canonical bytes/hashes for a fixed set of inputs and writes
 * vectors/canonical-forms.json. The committed JSON is the frozen artifact; the
 * test suite asserts the live implementation still reproduces it byte-for-byte.
 * Re-running this after an intentional algorithm change regenerates the freeze.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  cjsonString,
  sha256,
  cjson,
  taskCanonicalBytes,
  taskHash,
  manifestBytes,
  treeHash,
  manualIncludeBytes,
  manualIncludeHash,
  selectorConfigHash,
  weightPolicyHash,
  graphArtifactHash,
  receiptPayloadHash,
  canonicalReceiptPayload,
  ed25519PrivateKeyFromSeed,
  ed25519PublicKeyFromPrivate,
  ed25519PublicKeyToHex,
  ed25519Sign,
  type CanonicalValue,
  type CanonicalObject,
} from "../src/canonical/index.js";

const utf8 = (s: string): string => Buffer.from(s, "utf8").toString("hex");
const hashOf = (v: CanonicalValue): string => sha256(cjson(v));

// --- cjson vectors: each has two logically-equivalent inputs that must collapse
//     to identical canonical bytes. ---
const cjsonObjectA: CanonicalValue = { b: 2, a: 1, c: { y: true, x: null } };
const cjsonObjectB: CanonicalValue = { c: { x: null, y: true }, a: 1, b: 2 };

const cjsonNumbersA: CanonicalValue = { whole: 1.0, frac: 0.8, big: 1000000, neg: -0 };
const cjsonNumbersB: CanonicalValue = { neg: 0, big: 1000000, frac: 0.8, whole: 1 };

const cjsonUnicodeA: CanonicalValue = { "é": 1, a: 2, Z: 3, "01": 4 };
const cjsonUnicodeB: CanonicalValue = { "01": 4, Z: 3, a: 2, "é": 1 };

// --- task normalization vectors ---
const taskPlainA = "Fix the AUTH session bug";
const taskPlainB = "fix   THE    auth\tsession   BUG";
const taskNfkcA = "ﬁx the Auth"; // U+FB01 LATIN SMALL LIGATURE FI
const taskNfkcB = "fix the auth";

// --- manifest / tree_hash vectors ---
const manifestA = ["src/b.ts", "src/a.ts", "README.md", "src/a/b.ts"];
const manifestB = ["README.md", "src/a.ts", "src/a/b.ts", "src/b.ts"];

// --- manual include vectors ---
const manualA = ["src/policy/new_engine.ts", "src/a.ts"];
const manualB = ["src/a.ts", "src/policy/new_engine.ts"];

// --- selector config / weight policy vectors ---
const selectorConfigA: CanonicalValue = {
  ranking_strategy: {
    max_files: 40,
    edge_weights: { STATIC_IMPORT: 1.0, RE_EXPORT: 0.8 },
    max_depth_hops: 3,
  },
};
const selectorConfigB: CanonicalValue = {
  ranking_strategy: {
    edge_weights: { RE_EXPORT: 0.8, STATIC_IMPORT: 1.0 },
    max_depth_hops: 3,
    max_files: 40,
  },
};
const weightTableA: CanonicalValue = { STATIC_IMPORT: 1.0, RE_EXPORT: 0.8, DYNAMIC_IMPORT: 0.5 };
const weightTableB: CanonicalValue = { DYNAMIC_IMPORT: 0.5, RE_EXPORT: 0.8, STATIC_IMPORT: 1.0 };

// --- graph artifact vectors (minimal) ---
const graphA: CanonicalValue = {
  $schema: "context-graph-v0",
  edges: [{ source: "src/a.ts", target: null, type: "DYNAMIC_IMPORT", resolved: false }],
  nodes: { "src/a.ts": { content_hash: "abc", token_count: 10 } },
};
const graphB: CanonicalValue = {
  nodes: { "src/a.ts": { token_count: 10, content_hash: "abc" } },
  edges: [{ type: "DYNAMIC_IMPORT", resolved: false, source: "src/a.ts", target: null }],
  $schema: "context-graph-v0",
};

// --- receipt payload vectors: receipt_hash + signature are excluded ---
const receiptCore: CanonicalObject = {
  version: "0.1",
  task: { task_hash: "deadbeef", task_class: "bugfix" },
  manual_include: ["src/a.ts"],
};
const receiptWithExtras: CanonicalObject = {
  ...receiptCore,
  receipt_hash: "SHOULD_BE_IGNORED",
  signature: { algorithm: "Ed25519", public_key: "00", value: "11" },
};

// --- signing vector (fixed seed -> deterministic key + signature) ---
const signingSeed = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const signingPriv = ed25519PrivateKeyFromSeed(signingSeed);
const signingPub = ed25519PublicKeyFromPrivate(signingPriv);
const signingPubHex = ed25519PublicKeyToHex(signingPub);
const signingMessageBytes = cjson(canonicalReceiptPayload(receiptCore));
const signingSignature = ed25519Sign(signingMessageBytes, signingPriv);

const vectors = {
  _comment:
    "FROZEN canonical-form vectors (SPEC §2). Regenerate only via scripts/generate-vectors.ts after an intentional, versioned algorithm change.",
  cjson: [
    {
      name: "object key ordering",
      inputs: [cjsonObjectA, cjsonObjectB],
      canonical: cjsonString(cjsonObjectA),
      sha256: hashOf(cjsonObjectA),
    },
    {
      name: "number forms (integer collapse, -0, fraction)",
      inputs: [cjsonNumbersA, cjsonNumbersB],
      canonical: cjsonString(cjsonNumbersA),
      sha256: hashOf(cjsonNumbersA),
    },
    {
      name: "unicode + numeric-string key sort by code point",
      inputs: [cjsonUnicodeA, cjsonUnicodeB],
      canonical: cjsonString(cjsonUnicodeA),
      sha256: hashOf(cjsonUnicodeA),
    },
  ],
  task: [
    {
      name: "whitespace + case folding + stopword removal",
      inputs: [taskPlainA, taskPlainB],
      tokens: ["fix", "auth", "session", "bug"],
      canonical_hex: Buffer.from(taskCanonicalBytes(taskPlainA)).toString("hex"),
      task_hash: taskHash(taskPlainA),
    },
    {
      name: "NFKC ligature equivalence",
      inputs: [taskNfkcA, taskNfkcB],
      tokens: ["fix", "auth"],
      canonical_hex: Buffer.from(taskCanonicalBytes(taskNfkcA)).toString("hex"),
      task_hash: taskHash(taskNfkcA),
    },
  ],
  manifest: [
    {
      name: "byte-sorted LF join",
      inputs: [manifestA, manifestB],
      manifest_hex: Buffer.from(manifestBytes(manifestA)).toString("hex"),
      tree_hash: treeHash(manifestA),
    },
  ],
  manual_include: [
    {
      name: "byte-sorted cjson array",
      inputs: [manualA, manualB],
      manual_include_hex: Buffer.from(manualIncludeBytes(manualA)).toString("hex"),
      manual_include_hash: manualIncludeHash(manualA),
    },
  ],
  selector_config: [
    {
      name: "config hash stable under key reorder",
      inputs: [selectorConfigA, selectorConfigB],
      selector_config_hash: selectorConfigHash(selectorConfigA),
    },
  ],
  weight_policy: [
    {
      name: "weight table hash stable under key reorder",
      inputs: [weightTableA, weightTableB],
      weight_policy_hash: weightPolicyHash(weightTableA),
    },
  ],
  graph_artifact: [
    {
      name: "graph hash stable under key reorder, null target preserved",
      inputs: [graphA, graphB],
      graph_artifact_hash: graphArtifactHash(graphA),
    },
  ],
  receipt_payload: [
    {
      name: "receipt_hash excludes receipt_hash + signature fields",
      inputs: [receiptCore, receiptWithExtras],
      receipt_hash: receiptPayloadHash(receiptCore),
    },
  ],
  signing: {
    name: "Ed25519 deterministic sign/verify",
    seed_hex: signingSeed,
    public_key_hex: signingPubHex,
    message_cjson_hex: Buffer.from(signingMessageBytes).toString("hex"),
    signature_hex: signingSignature,
  },
  _utf8_sanity: utf8("a"),
};

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "vectors");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "canonical-forms.json");
writeFileSync(outPath, JSON.stringify(vectors, null, 2) + "\n", "utf8");
process.stdout.write(`wrote ${outPath}\n`);
