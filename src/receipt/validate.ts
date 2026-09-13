import { isTaskClass } from "../enums.js";
import { SchemaValidationError } from "../errors.js";
import type { Receipt } from "./types.js";

/** Validate the external JSON boundary before hashing or dereferencing fields. */
export function validateReceipt(value: unknown): asserts value is Receipt {
  const object = (v: unknown, path: string): Record<string, unknown> => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      throw new SchemaValidationError(`${path}: expected an object`);
    }
    return v as Record<string, unknown>;
  };
  const string = (v: unknown, path: string): string => {
    if (typeof v !== "string") throw new SchemaValidationError(`${path}: expected a string`);
    return v;
  };
  const strings = (v: unknown, path: string): void => {
    if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) {
      throw new SchemaValidationError(`${path}: expected an array of strings`);
    }
  };
  const root = object(value, "receipt");
  if (root["version"] !== "0.1") throw new SchemaValidationError("version: unsupported receipt version");
  for (const key of ["timestamp", "task_id", "receipt_hash", "manual_include_hash"]) string(root[key], key);
  if (root["prev_receipt_hash"] !== null) string(root["prev_receipt_hash"], "prev_receipt_hash");
  const fields: Record<string, string[]> = {
    repository: ["origin", "commit_sha", "tree_hash"],
    task: ["task_hash", "task_class"],
    selector: ["version", "config_hash", "weight_policy_hash"],
    graph: ["graph_artifact_hash"],
    signature: ["algorithm", "public_key", "value"],
  };
  for (const [key, names] of Object.entries(fields)) {
    const nested = object(root[key], key);
    for (const name of names) string(nested[name], `${key}.${name}`);
  }
  const task = object(root["task"], "task");
  if (!isTaskClass(task["task_class"] as string)) throw new SchemaValidationError("task.task_class: unknown task class");
  const graph = object(root["graph"], "graph");
  const generator = object(graph["graph_generator"], "graph.graph_generator");
  string(generator["name"], "graph.graph_generator.name");
  string(generator["version"], "graph.graph_generator.version");
  if (typeof graph["graph_supplied_externally"] !== "boolean") throw new SchemaValidationError("graph.graph_supplied_externally: expected a boolean");
  strings(root["manual_include"], "manual_include");
  for (const key of ["selection", "exclusions"]) {
    if (!Array.isArray(root[key])) throw new SchemaValidationError(`${key}: expected an array`);
  }
  // Selection, exclusions and coverage receive exact canonical comparison with
  // the replayed pipeline below; this guard prevents unsafe property access.
  object(root["coverage"], "coverage");
}
