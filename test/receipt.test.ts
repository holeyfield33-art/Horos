/**
 * Receipt generation, hashing, and signing — SPEC §5, PR 5.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { cjsonString, generateEd25519KeyPair } from "../src/canonical/index.js";
import { loadGraphArtifact } from "../src/graph/index.js";
import { loadSelectorConfig } from "../src/config/index.js";
import { selectContext } from "../src/pipeline/index.js";
import {
  buildReceipt,
  recomputeReceiptHash,
  verifyReceiptSignature,
  toChainLink,
  type BuildReceiptInput,
  type Receipt,
} from "../src/receipt/index.js";

const graph = loadGraphArtifact(
  JSON.parse(readFileSync(new URL("./fixtures/pipeline/basic-graph.json", import.meta.url), "utf8")) as unknown,
).artifact;

const config = loadSelectorConfig();
const selectionResult = selectContext({ graph, task: "fix the auth session", config });
const { privateKey } = generateEd25519KeyPair();

function baseInput(overrides: Partial<BuildReceiptInput> = {}): BuildReceiptInput {
  return {
    selectionResult,
    repository: { origin: "github.com/org/repo", commit_sha: "abc", tree_hash: "def" },
    taskText: "fix the auth session",
    taskClass: "bugfix",
    config,
    graphArtifactHash: "graphhash",
    graphGenerator: { name: "typescript", version: "5.8.2" },
    manualInclude: [],
    prevReceiptHash: null,
    privateKey,
    timestamp: "2026-06-20T00:00:00.000Z",
    taskId: "00000000-0000-4000-8000-000000000000",
    ...overrides,
  };
}

describe("receipt generation (§5)", () => {
  it("computes a receipt_hash that round-trips through cjson", () => {
    const receipt = buildReceipt(baseInput());
    expect(receipt.receipt_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(recomputeReceiptHash(receipt)).toBe(receipt.receipt_hash);
    // cjson serialization is stable.
    expect(cjsonString(receipt)).toBe(cjsonString(receipt));
  });

  it("signs with Ed25519 and the signature verifies", () => {
    const receipt = buildReceipt(baseInput());
    expect(receipt.signature.algorithm).toBe("Ed25519");
    expect(verifyReceiptSignature(receipt)).toBe(true);
  });

  it("includes manual_include_hash and tree_hash provenance", () => {
    const receipt = buildReceipt(baseInput({ manualInclude: ["src/z.ts", "src/a.ts"] }));
    expect(receipt.manual_include).toEqual(["src/a.ts", "src/z.ts"]); // byte-sorted
    expect(receipt.manual_include_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.repository.tree_hash).toBe("def");
  });

  it("is deterministic given the same timestamp and task_id", () => {
    expect(buildReceipt(baseInput()).receipt_hash).toBe(buildReceipt(baseInput()).receipt_hash);
  });

  it("rejects an unknown task_class", () => {
    // @ts-expect-error deliberately invalid enum value
    expect(() => buildReceipt(baseInput({ taskClass: "nope" }))).toThrow(/task_class/);
  });
});

describe("tamper detection (§5)", () => {
  const receipt = buildReceipt(baseInput());

  it("altering task_class breaks the hash", () => {
    const tampered: Receipt = { ...receipt, task: { ...receipt.task, task_class: "feature" } };
    expect(recomputeReceiptHash(tampered)).not.toBe(receipt.receipt_hash);
  });

  it("altering the selection breaks the hash", () => {
    const tampered: Receipt = { ...receipt, selection: receipt.selection.slice(0, 1) };
    expect(recomputeReceiptHash(tampered)).not.toBe(receipt.receipt_hash);
  });

  it("altering coverage breaks the hash", () => {
    const tampered: Receipt = {
      ...receipt,
      coverage: { ...receipt.coverage, files_selected: 999 },
    };
    expect(recomputeReceiptHash(tampered)).not.toBe(receipt.receipt_hash);
  });

  it("a tampered signature fails verification", () => {
    const flipped = receipt.signature.value.startsWith("00")
      ? "ff" + receipt.signature.value.slice(2)
      : "00" + receipt.signature.value.slice(2);
    const tampered: Receipt = {
      ...receipt,
      signature: { ...receipt.signature, value: flipped },
    };
    expect(verifyReceiptSignature(tampered)).toBe(false);
  });
});

describe("chain linking (§5.1)", () => {
  it("threads prev_receipt_hash and projects a chain-link", () => {
    const first = buildReceipt(baseInput());
    const second = buildReceipt(
      baseInput({ prevReceiptHash: first.receipt_hash, taskId: "00000000-0000-4000-8000-000000000001" }),
    );
    expect(second.prev_receipt_hash).toBe(first.receipt_hash);
    expect(second.receipt_hash).not.toBe(first.receipt_hash);

    const link = toChainLink(second, "chain-1", 2);
    expect(link).toEqual({
      chain_id: "chain-1",
      seq: 2,
      prev_receipt_hash: first.receipt_hash,
      receipt_hash: second.receipt_hash,
      signature: second.signature.value,
    });
  });
});
