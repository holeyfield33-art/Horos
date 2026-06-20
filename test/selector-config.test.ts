/**
 * Selector config & weight policy hashing — SPEC §2.5, §6, PR 2.
 */

import { describe, it, expect } from "vitest";

import {
  DEFAULT_SELECTOR_CONFIG,
  computeSelectorConfigHash,
  computeWeightPolicyHash,
  loadSelectorConfig,
  parseSelectorConfigOverride,
  type SelectorConfig,
} from "../src/config/index.js";
import { SchemaValidationError } from "../src/errors.js";

describe("default config (§6)", () => {
  it("matches the spec ranking strategy", () => {
    const rs = DEFAULT_SELECTOR_CONFIG.ranking_strategy;
    expect(rs.edge_weights).toEqual({
      STATIC_IMPORT: 1.0,
      RE_EXPORT: 0.8,
      DYNAMIC_IMPORT: 0.5,
      FRAMEWORK_ROUTE: 1.2,
      TEST_REFERENCE: 0.1,
      CONFIG_REFERENCE: 0.4,
    });
    expect(rs.max_depth_hops).toBe(3);
    expect(rs.max_files).toBe(40);
    expect(rs.max_tokens).toBe(60000);
  });
});

describe("selector_config_hash (§2.5)", () => {
  it("is stable under key reordering", () => {
    const reordered: SelectorConfig = {
      ranking_strategy: {
        max_tokens: DEFAULT_SELECTOR_CONFIG.ranking_strategy.max_tokens,
        max_files: DEFAULT_SELECTOR_CONFIG.ranking_strategy.max_files,
        max_depth_hops: DEFAULT_SELECTOR_CONFIG.ranking_strategy.max_depth_hops,
        edge_weights: {
          CONFIG_REFERENCE: 0.4,
          TEST_REFERENCE: 0.1,
          FRAMEWORK_ROUTE: 1.2,
          DYNAMIC_IMPORT: 0.5,
          RE_EXPORT: 0.8,
          STATIC_IMPORT: 1.0,
        },
      },
      entrypoint_rules: DEFAULT_SELECTOR_CONFIG.entrypoint_rules,
      task_normalization: DEFAULT_SELECTOR_CONFIG.task_normalization,
      version: DEFAULT_SELECTOR_CONFIG.version,
    };
    expect(computeSelectorConfigHash(reordered)).toBe(
      computeSelectorConfigHash(DEFAULT_SELECTOR_CONFIG),
    );
  });

  it("changes when any field changes", () => {
    const changed = loadSelectorConfig({ ranking_strategy: { max_files: 41 } });
    expect(computeSelectorConfigHash(changed)).not.toBe(
      computeSelectorConfigHash(DEFAULT_SELECTOR_CONFIG),
    );
  });
});

describe("weight_policy_hash (§2.5)", () => {
  it("changes iff the weight table changes", () => {
    const base = computeWeightPolicyHash(DEFAULT_SELECTOR_CONFIG);

    // A non-weight change leaves the weight policy hash untouched.
    const budgetChanged = loadSelectorConfig({ ranking_strategy: { max_files: 10 } });
    expect(computeWeightPolicyHash(budgetChanged)).toBe(base);
    expect(computeSelectorConfigHash(budgetChanged)).not.toBe(
      computeSelectorConfigHash(DEFAULT_SELECTOR_CONFIG),
    );

    // A weight change moves it.
    const weightChanged = loadSelectorConfig({
      ranking_strategy: { edge_weights: { DYNAMIC_IMPORT: 0.9 } },
    });
    expect(computeWeightPolicyHash(weightChanged)).not.toBe(base);
  });

  it("is stable under weight-table key reordering", () => {
    const reordered = loadSelectorConfig({
      ranking_strategy: {
        edge_weights: {
          CONFIG_REFERENCE: 0.4,
          STATIC_IMPORT: 1.0,
          DYNAMIC_IMPORT: 0.5,
        },
      },
    });
    expect(computeWeightPolicyHash(reordered)).toBe(
      computeWeightPolicyHash(DEFAULT_SELECTOR_CONFIG),
    );
  });
});

describe("override loading (overridable by file)", () => {
  it("merges a partial override over defaults", () => {
    const cfg = loadSelectorConfig({
      ranking_strategy: { max_files: 5, edge_weights: { STATIC_IMPORT: 2.0 } },
    });
    expect(cfg.ranking_strategy.max_files).toBe(5);
    expect(cfg.ranking_strategy.edge_weights.STATIC_IMPORT).toBe(2.0);
    expect(cfg.ranking_strategy.edge_weights.RE_EXPORT).toBe(0.8);
    expect(cfg.ranking_strategy.max_tokens).toBe(60000);
  });

  it("parses a valid override object", () => {
    const override = parseSelectorConfigOverride({
      ranking_strategy: { max_depth_hops: 2 },
    });
    expect(override.ranking_strategy?.max_depth_hops).toBe(2);
  });

  it("rejects an unknown edge type in an override", () => {
    expect(() =>
      parseSelectorConfigOverride({ ranking_strategy: { edge_weights: { NOPE: 1 } } }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects a non-numeric budget", () => {
    expect(() =>
      parseSelectorConfigOverride({ ranking_strategy: { max_files: "lots" } }),
    ).toThrow(/expected a finite number/);
  });
});
