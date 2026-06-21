/**
 * Selector config and weight policy — SPEC §2.5, §6.
 *
 * The selector config is everything that makes selection deterministic and must
 * be versioned: the selector version, the task-normalization policy (§2.2), the
 * entrypoint discovery rules and their scores (§6.1), and the ranking strategy
 * (edge weights, depth, budgets — §6). `selector_config_hash` covers all of it;
 * `weight_policy_hash` covers only the edge-weight table so a ranking dispute
 * resolves to exactly that table (§2.5).
 *
 * Object types here are `type` aliases (not interfaces) so they carry an implicit
 * index signature and are directly assignable to `CanonicalValue` — no casts.
 */

import { readFileSync } from "node:fs";

import {
  selectorConfigHash as canonicalSelectorConfigHash,
  weightPolicyHash as canonicalWeightPolicyHash,
  TASK_NORMALIZATION_POLICY,
} from "../canonical/index.js";
import { EDGE_TYPES, type EdgeType } from "../enums.js";
import { SchemaValidationError } from "../errors.js";

export const SELECTOR_VERSION = "0.1.0";
export const ENTRYPOINT_RULES_VERSION = "v1";

export type EdgeWeights = { readonly [K in EdgeType]: number };

export type RankingStrategy = {
  readonly edge_weights: EdgeWeights;
  readonly max_depth_hops: number;
  readonly max_files: number;
  readonly max_tokens: number;
};

export type EntrypointRules = {
  readonly version: string;
  readonly exact_filename_match: number;
  readonly containing_directory_match: number;
  readonly exported_symbol_match: number;
  readonly test_pair_match: number;
  readonly config_route_reference: number;
};

export type TaskNormalizationPolicy = {
  readonly unicode_normalization: string;
  readonly case_folding: string;
  readonly tokenization_rule: string;
  readonly stopword_list_version: string;
};

export type SelectorConfig = {
  readonly version: string;
  readonly task_normalization: TaskNormalizationPolicy;
  readonly entrypoint_rules: EntrypointRules;
  readonly ranking_strategy: RankingStrategy;
};

export const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  version: SELECTOR_VERSION,
  task_normalization: {
    unicode_normalization: TASK_NORMALIZATION_POLICY.unicode_normalization,
    case_folding: TASK_NORMALIZATION_POLICY.case_folding,
    tokenization_rule: TASK_NORMALIZATION_POLICY.tokenization_rule,
    stopword_list_version: TASK_NORMALIZATION_POLICY.stopword_list_version,
  },
  entrypoint_rules: {
    version: ENTRYPOINT_RULES_VERSION,
    exact_filename_match: 100,
    containing_directory_match: 50,
    exported_symbol_match: 40,
    test_pair_match: 30,
    config_route_reference: 20,
  },
  ranking_strategy: {
    edge_weights: {
      STATIC_IMPORT: 1.0,
      RE_EXPORT: 0.8,
      DYNAMIC_IMPORT: 0.5,
      FRAMEWORK_ROUTE: 1.2,
      TEST_REFERENCE: 0.1,
      CONFIG_REFERENCE: 0.4,
    },
    max_depth_hops: 3,
    max_files: 40,
    max_tokens: 60000,
  },
};

/** `selector_config_hash`: sha256(cjson(selector_config)). */
export function computeSelectorConfigHash(config: SelectorConfig): string {
  return canonicalSelectorConfigHash(config);
}

/** `weight_policy_hash`: sha256(cjson(edge_weights)) — the edge-weight table only. */
export function computeWeightPolicyHash(config: SelectorConfig): string {
  return canonicalWeightPolicyHash(config.ranking_strategy.edge_weights);
}

// --- overrides ---------------------------------------------------------------

export type RankingStrategyOverride = {
  readonly edge_weights?: Partial<EdgeWeights>;
  readonly max_depth_hops?: number;
  readonly max_files?: number;
  readonly max_tokens?: number;
};

export type SelectorConfigOverride = {
  readonly version?: string;
  readonly task_normalization?: Partial<TaskNormalizationPolicy>;
  readonly entrypoint_rules?: Partial<EntrypointRules>;
  readonly ranking_strategy?: RankingStrategyOverride;
};

function mergeEdgeWeights(base: EdgeWeights, override?: Partial<EdgeWeights>): EdgeWeights {
  if (override === undefined) return base;
  const result: { [K in EdgeType]: number } = { ...base };
  for (const type of EDGE_TYPES) {
    const value = override[type];
    if (value !== undefined) result[type] = value;
  }
  return result;
}

/** Apply a (validated) override on top of the default config. */
export function loadSelectorConfig(override?: SelectorConfigOverride): SelectorConfig {
  const base = DEFAULT_SELECTOR_CONFIG;
  if (override === undefined) return base;

  const rs = override.ranking_strategy;
  return {
    version: override.version ?? base.version,
    task_normalization: { ...base.task_normalization, ...override.task_normalization },
    entrypoint_rules: { ...base.entrypoint_rules, ...override.entrypoint_rules },
    ranking_strategy: {
      edge_weights: mergeEdgeWeights(base.ranking_strategy.edge_weights, rs?.edge_weights),
      max_depth_hops: rs?.max_depth_hops ?? base.ranking_strategy.max_depth_hops,
      max_files: rs?.max_files ?? base.ranking_strategy.max_files,
      max_tokens: rs?.max_tokens ?? base.ranking_strategy.max_tokens,
    },
  };
}

// --- override validation (file input is untrusted) ---------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SchemaValidationError(`${path}: expected a finite number`);
  }
  return value;
}

function checkString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new SchemaValidationError(`${path}: expected a string`);
  }
  return value;
}

/** Validate untrusted JSON into a SelectorConfigOverride (rejects unknown keys). */
export function parseSelectorConfigOverride(input: unknown): SelectorConfigOverride {
  const root = isPlainObject(input) ? input : null;
  if (root === null) throw new SchemaValidationError("<root>: expected an object");

  const override: {
    version?: string;
    task_normalization?: Partial<TaskNormalizationPolicy>;
    entrypoint_rules?: Partial<EntrypointRules>;
    ranking_strategy?: RankingStrategyOverride;
  } = {};

  if (root["version"] !== undefined) override.version = checkString(root["version"], "version");

  if (root["ranking_strategy"] !== undefined) {
    if (!isPlainObject(root["ranking_strategy"])) {
      throw new SchemaValidationError("ranking_strategy: expected an object");
    }
    const rs = root["ranking_strategy"];
    const parsed: {
      edge_weights?: Partial<EdgeWeights>;
      max_depth_hops?: number;
      max_files?: number;
      max_tokens?: number;
    } = {};

    if (rs["edge_weights"] !== undefined) {
      if (!isPlainObject(rs["edge_weights"])) {
        throw new SchemaValidationError("ranking_strategy.edge_weights: expected an object");
      }
      const weights: { [K in EdgeType]?: number } = {};
      for (const [key, value] of Object.entries(rs["edge_weights"])) {
        const type = EDGE_TYPES.find((t) => t === key);
        if (type === undefined) {
          throw new SchemaValidationError(
            `ranking_strategy.edge_weights.${key}: unknown edge type`,
          );
        }
        weights[type] = checkNumber(value, `ranking_strategy.edge_weights.${key}`);
      }
      parsed.edge_weights = weights;
    }
    if (rs["max_depth_hops"] !== undefined) {
      parsed.max_depth_hops = checkNumber(rs["max_depth_hops"], "ranking_strategy.max_depth_hops");
    }
    if (rs["max_files"] !== undefined) {
      parsed.max_files = checkNumber(rs["max_files"], "ranking_strategy.max_files");
    }
    if (rs["max_tokens"] !== undefined) {
      parsed.max_tokens = checkNumber(rs["max_tokens"], "ranking_strategy.max_tokens");
    }
    override.ranking_strategy = parsed;
  }

  return override;
}

/** Read a selector-config override file and apply it over the default config. */
export function loadSelectorConfigFile(path: string): SelectorConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SchemaValidationError(`cannot read selector config ${path}: ${detail}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SchemaValidationError(`selector config is not valid JSON: ${detail}`);
  }
  return loadSelectorConfig(parseSelectorConfigOverride(parsed));
}
