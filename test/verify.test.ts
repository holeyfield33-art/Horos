/**
 * Receipt replay verification + verify CLI — SPEC §5.3, PR 6.
 *
 * Acceptance: no receipt this build can produce should fail to replay here.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { generateEd25519KeyPair } from "../src/canonical/index.js";
import { loadGraphArtifact } from "../src/graph/index.js";
import { loadSelectorConfig } from "../src/config/index.js";
import { selectContext } from "../src/pipeline/index.js";
import { buildReceipt, type Receipt } from "../src/receipt/index.js";
import { verifyReceipt, type ReplayInputs } from "../src/verify/index.js";
import { run } from "../src/cli/horos.js";

const url = (rel: string): URL => new URL(rel, import.meta.url);
const path = (rel: string): string => fileURLToPath(url(rel));
const readJson = (rel: string): unknown => JSON.parse(readFileSync(url(rel), "utf8")) as unknown;

const TASK = "fix the auth session";
const GRAPH_PATH = path("./fixtures/pipeline/basic-graph.json");
const graphJson = readJson("./fixtures/pipeline/basic-graph.json");
const loaded = loadGraphArtifact(graphJson);
const config = loadSelectorConfig();
const { privateKey } = generateEd25519KeyPair();

function makeReceipt(): Receipt {
  const selectionResult = selectContext({ graph: loaded.artifact, task: TASK, config });
  return buildReceipt({
    selectionResult,
    repository: { origin: "github.com/org/repo", commit_sha: "abc", tree_hash: "def" },
    taskText: TASK,
    taskClass: "bugfix",
    config,
    graphArtifactHash: loaded.graphArtifactHash,
    graphGenerator: { name: "typescript", version: "5.8.2" },
    manualInclude: [],
    prevReceiptHash: null,
    privateKey,
    timestamp: "2026-06-20T00:00:00.000Z",
    taskId: "00000000-0000-4000-8000-000000000000",
  });
}

function goodInputs(): ReplayInputs {
  return { graph: graphJson, taskText: TASK, config, manualInclude: [] };
}

describe("verifyReceipt (§5.3)", () => {
  it("a freshly built receipt replays (acceptance: no unreplayable receipt)", () => {
    expect(verifyReceipt(makeReceipt(), goodInputs())).toEqual({ pass: true });
  });

  it("fails with task.task_hash when the task is altered", () => {
    const outcome = verifyReceipt(makeReceipt(), { ...goodInputs(), taskText: "different task" });
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.field).toBe("task.task_hash");
  });

  it("fails with graph.graph_artifact_hash when a different graph is supplied", () => {
    const otherGraph = readJson("./fixtures/content/graph.json");
    const outcome = verifyReceipt(makeReceipt(), { ...goodInputs(), graph: otherGraph });
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.field).toBe("graph.graph_artifact_hash");
  });

  it("fails with selector.config_hash when the config is altered", () => {
    const altered = loadSelectorConfig({ ranking_strategy: { max_files: 7 } });
    const outcome = verifyReceipt(makeReceipt(), { ...goodInputs(), config: altered });
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.field).toBe("selector.config_hash");
  });

  it("fails with manual_include_hash when manual includes differ", () => {
    const outcome = verifyReceipt(makeReceipt(), { ...goodInputs(), manualInclude: ["src/x.ts"] });
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.field).toBe("manual_include_hash");
  });

  it("fails with receipt_hash when the receipt payload is tampered", () => {
    const receipt = makeReceipt();
    const tampered: Receipt = { ...receipt, coverage: { ...receipt.coverage, files_selected: 999 } };
    const outcome = verifyReceipt(tampered, goodInputs());
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.field).toBe("receipt_hash");
  });

  it("fails with signature when the signature is tampered (but hash intact)", () => {
    const receipt = makeReceipt();
    const flipped = (receipt.signature.value.startsWith("00") ? "ff" : "00") +
      receipt.signature.value.slice(2);
    // Recompute receipt_hash stays valid since signature is excluded from it.
    const tampered: Receipt = { ...receipt, signature: { ...receipt.signature, value: flipped } };
    const outcome = verifyReceipt(tampered, goodInputs());
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.field).toBe("signature");
  });
});

describe("content re-verification through verify (§6.4 + §5.3)", () => {
  const contentGraphJson = readJson("./fixtures/content/graph.json");
  const contentLoaded = loadGraphArtifact(contentGraphJson);
  const contentTask = "alpha beta";

  function contentReceipt(): Receipt {
    const selectionResult = selectContext({
      graph: contentLoaded.artifact,
      task: contentTask,
      config,
    });
    return buildReceipt({
      selectionResult,
      repository: { origin: "x", commit_sha: "c", tree_hash: "t" },
      taskText: contentTask,
      taskClass: "audit",
      config,
      graphArtifactHash: contentLoaded.graphArtifactHash,
      graphGenerator: { name: "typescript", version: "5.8.2" },
      manualInclude: [],
      prevReceiptHash: null,
      privateKey,
      timestamp: "2026-06-20T00:00:00.000Z",
      taskId: "00000000-0000-4000-8000-000000000002",
    });
  }

  it("passes against the matching repo", () => {
    const outcome = verifyReceipt(contentReceipt(), {
      graph: contentGraphJson,
      taskText: contentTask,
      config,
      manualInclude: [],
      repoRoot: path("./fixtures/content/repo"),
    });
    expect(outcome).toEqual({ pass: true });
  });

  it("fails with content against a drifted repo", () => {
    const outcome = verifyReceipt(contentReceipt(), {
      graph: contentGraphJson,
      taskText: contentTask,
      config,
      manualInclude: [],
      repoRoot: path("./fixtures/content/repo-drift"),
    });
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.field).toBe("content");
      expect(outcome.detail).toBe("content drift alpha.ts");
    }
  });
});

describe("verify CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "horos-"));
  const receiptPath = join(dir, "receipt.json");
  writeFileSync(receiptPath, JSON.stringify(makeReceipt()), "utf8");

  it("prints PASS and exits 0 for a valid receipt", () => {
    const result = run(["verify", receiptPath, "--graph", GRAPH_PATH, "--task", TASK]);
    expect(result.code).toBe(0);
    expect(result.lines[0]).toMatch(/^PASS [0-9a-f]{64}$/);
  });

  it("prints FAIL with the field and exits 1 for a wrong task", () => {
    const result = run(["verify", receiptPath, "--graph", GRAPH_PATH, "--task", "wrong"]);
    expect(result.code).toBe(1);
    expect(result.lines[0]).toBe("FAIL task.task_hash: supplied task does not match the recorded task_hash");
  });

  it("exits 2 on usage error", () => {
    expect(run(["verify", receiptPath]).code).toBe(2);
    expect(run(["bogus"]).code).toBe(2);
  });
});
