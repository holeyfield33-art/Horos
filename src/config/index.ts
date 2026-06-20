/** Selector config & weight policy — SPEC §2.5, §6. */

export {
  SELECTOR_VERSION,
  ENTRYPOINT_RULES_VERSION,
  DEFAULT_SELECTOR_CONFIG,
  computeSelectorConfigHash,
  computeWeightPolicyHash,
  loadSelectorConfig,
  loadSelectorConfigFile,
  parseSelectorConfigOverride,
  type SelectorConfig,
  type RankingStrategy,
  type EdgeWeights,
  type EntrypointRules,
  type TaskNormalizationPolicy,
  type SelectorConfigOverride,
  type RankingStrategyOverride,
} from "./selector-config.js";
