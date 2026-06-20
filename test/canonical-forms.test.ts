/**
 * Frozen-vector tests for the canonical forms — SPEC §2, PR 0 acceptance.
 *
 * For every canonical form, the two logically-equivalent inputs in each vector
 * must (a) collapse to identical canonical bytes and (b) reproduce the frozen
 * hash committed in vectors/canonical-forms.json. Drift in either direction
 * fails the build.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import {
  cjson,
  cjsonString,
  sha256,
  taskCanonicalBytes,
  taskHash,
  normalizeTaskTokens,
  manifestBytes,
  treeHash,
  manualIncludeBytes,
  manualIncludeHash,
  selectorConfigHash,
  weightPolicyHash,
  graphArtifactHash,
  receiptPayloadHash,
  type CanonicalValue,
  type CanonicalObject,
} from "../src/canonical/index.js";

interface CjsonVector {
  name: string;
  inputs: [CanonicalValue, CanonicalValue];
  canonical: string;
  sha256: string;
}
interface TaskVector {
  name: string;
  inputs: [string, string];
  tokens: string[];
  canonical_hex: string;
  task_hash: string;
}
interface PathListVector {
  name: string;
  inputs: [string[], string[]];
  manifest_hex?: string;
  tree_hash?: string;
  manual_include_hex?: string;
  manual_include_hash?: string;
}
interface ValuePairHashVector {
  name: string;
  inputs: [CanonicalValue, CanonicalValue];
  selector_config_hash?: string;
  weight_policy_hash?: string;
  graph_artifact_hash?: string;
  receipt_hash?: string;
}
interface VectorsFile {
  cjson: CjsonVector[];
  task: TaskVector[];
  manifest: PathListVector[];
  manual_include: PathListVector[];
  selector_config: ValuePairHashVector[];
  weight_policy: ValuePairHashVector[];
  graph_artifact: ValuePairHashVector[];
  receipt_payload: ValuePairHashVector[];
}

const vectors: VectorsFile = JSON.parse(
  readFileSync(new URL("../vectors/canonical-forms.json", import.meta.url), "utf8"),
) as VectorsFile;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

describe("cjson (§2.1)", () => {
  for (const v of vectors.cjson) {
    it(`equivalent inputs collapse identically: ${v.name}`, () => {
      const a = cjsonString(v.inputs[0]);
      const b = cjsonString(v.inputs[1]);
      expect(a).toBe(b);
      expect(a).toBe(v.canonical);
      expect(sha256(cjson(v.inputs[0]))).toBe(v.sha256);
      expect(sha256(cjson(v.inputs[1]))).toBe(v.sha256);
    });
  }

  it("rejects non-finite numbers", () => {
    expect(() => cjsonString(Number.NaN)).toThrow();
    expect(() => cjsonString(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("omits undefined object values, keeps explicit null", () => {
    const withUndefined: CanonicalObject = { a: 1, b: undefined, c: null };
    expect(cjsonString(withUndefined)).toBe('{"a":1,"c":null}');
  });
});

describe("task normalization (§2.2)", () => {
  for (const v of vectors.task) {
    it(`equivalent tasks hash identically: ${v.name}`, () => {
      expect(normalizeTaskTokens(v.inputs[0])).toEqual(v.tokens);
      expect(normalizeTaskTokens(v.inputs[1])).toEqual(v.tokens);
      expect(hex(taskCanonicalBytes(v.inputs[0]))).toBe(v.canonical_hex);
      expect(taskHash(v.inputs[0])).toBe(v.task_hash);
      expect(taskHash(v.inputs[1])).toBe(v.task_hash);
    });
  }
});

describe("repo manifest / tree_hash (§2.3)", () => {
  for (const v of vectors.manifest) {
    it(`shuffled path list hashes identically: ${v.name}`, () => {
      expect(hex(manifestBytes(v.inputs[0]))).toBe(v.manifest_hex);
      expect(treeHash(v.inputs[0])).toBe(v.tree_hash);
      expect(treeHash(v.inputs[1])).toBe(v.tree_hash);
    });
  }
});

describe("manual includes (§2.4)", () => {
  for (const v of vectors.manual_include) {
    it(`shuffled includes hash identically: ${v.name}`, () => {
      expect(hex(manualIncludeBytes(v.inputs[0]))).toBe(v.manual_include_hex);
      expect(manualIncludeHash(v.inputs[0])).toBe(v.manual_include_hash);
      expect(manualIncludeHash(v.inputs[1])).toBe(v.manual_include_hash);
    });
  }
});

describe("selector config & weight policy (§2.5)", () => {
  for (const v of vectors.selector_config) {
    it(`config hash stable under key reorder: ${v.name}`, () => {
      expect(selectorConfigHash(v.inputs[0])).toBe(v.selector_config_hash);
      expect(selectorConfigHash(v.inputs[1])).toBe(v.selector_config_hash);
    });
  }
  for (const v of vectors.weight_policy) {
    it(`weight policy hash stable under key reorder: ${v.name}`, () => {
      expect(weightPolicyHash(v.inputs[0])).toBe(v.weight_policy_hash);
      expect(weightPolicyHash(v.inputs[1])).toBe(v.weight_policy_hash);
    });
  }
});

describe("graph artifact hash (§2.1 over graph)", () => {
  for (const v of vectors.graph_artifact) {
    it(`graph hash stable, null target preserved: ${v.name}`, () => {
      expect(graphArtifactHash(v.inputs[0])).toBe(v.graph_artifact_hash);
      expect(graphArtifactHash(v.inputs[1])).toBe(v.graph_artifact_hash);
    });
  }
});

describe("receipt payload hash (§5)", () => {
  for (const v of vectors.receipt_payload) {
    it(`excludes receipt_hash + signature: ${v.name}`, () => {
      const core = v.inputs[0] as CanonicalObject;
      const withExtras = v.inputs[1] as CanonicalObject;
      expect(receiptPayloadHash(core)).toBe(v.receipt_hash);
      expect(receiptPayloadHash(withExtras)).toBe(v.receipt_hash);
    });
  }
});
