/**
 * Versioned, closed enums — SPEC §4 (edge types, `resolution_error`) and §5
 * (`reason_code`, `task_class`). An unrecognized value is a hard validation
 * failure, never a silent skip (§4 compatibility rule).
 */

export const EDGE_TYPES = [
  "STATIC_IMPORT",
  "RE_EXPORT",
  "DYNAMIC_IMPORT",
  "FRAMEWORK_ROUTE",
  "TEST_REFERENCE",
  "CONFIG_REFERENCE",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const RESOLUTION_ERRORS = [
  "alias_not_found",
  "dynamic_template_literal",
  "module_not_found",
  "unsupported_syntax",
  "external_boundary",
] as const;
export type ResolutionError = (typeof RESOLUTION_ERRORS)[number];

export const REASON_CODES = [
  "HEURISTIC_IGNORE_TESTS",
  "HEURISTIC_IGNORE_BUILD",
  "BUDGET_TRUNCATED",
  "DEPTH_EXCEEDED",
  "EXPLICIT_EXCLUDE",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const TASK_CLASSES = ["audit", "bugfix", "feature", "test", "other"] as const;
export type TaskClass = (typeof TASK_CLASSES)[number];

const EDGE_TYPE_SET: ReadonlySet<string> = new Set(EDGE_TYPES);
const RESOLUTION_ERROR_SET: ReadonlySet<string> = new Set(RESOLUTION_ERRORS);
const REASON_CODE_SET: ReadonlySet<string> = new Set(REASON_CODES);
const TASK_CLASS_SET: ReadonlySet<string> = new Set(TASK_CLASSES);

export function isEdgeType(value: string): value is EdgeType {
  return EDGE_TYPE_SET.has(value);
}
export function isResolutionError(value: string): value is ResolutionError {
  return RESOLUTION_ERROR_SET.has(value);
}
export function isReasonCode(value: string): value is ReasonCode {
  return REASON_CODE_SET.has(value);
}
export function isTaskClass(value: string): value is TaskClass {
  return TASK_CLASS_SET.has(value);
}
