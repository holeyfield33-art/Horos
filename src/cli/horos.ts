/**
 * `horos` CLI — SPEC §5.3 verify command.
 *
 *   horos verify <receipt.json> --graph <graph.json> --task <text>
 *       [--task-file <file>] [--config <config.json>]
 *       [--manual a.ts,b.ts] [--repo <dir>]
 *
 * Re-runs selection from the supplied inputs, asserts the receipt replays
 * identically, and verifies the signature. Prints PASS / FAIL with the exact
 * diverging field. Exit code 0 on PASS, 1 on FAIL, 2 on usage error.
 */

import { readFileSync } from "node:fs";

import { loadSelectorConfig, loadSelectorConfigFile, type SelectorConfig } from "../config/index.js";
import type { Receipt } from "../receipt/index.js";
import { verifyReceipt, type ReplayInputs } from "../verify/index.js";

export type CliResult = { readonly code: number; readonly lines: readonly string[] };

type Flags = { readonly positional: string[]; readonly options: Map<string, string> };

const VALUE_FLAGS = new Set([
  "--graph",
  "--task",
  "--task-file",
  "--config",
  "--manual",
  "--repo",
]);

function parseFlags(argv: readonly string[]): Flags {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      options.set(arg, value);
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function asReceipt(value: unknown): Receipt {
  if (typeof value !== "object" || value === null) {
    throw new Error("receipt is not a JSON object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record["receipt_hash"] !== "string" || typeof record["signature"] !== "object") {
    throw new Error("receipt is missing receipt_hash or signature");
  }
  return value as Receipt;
}

function resolveConfig(options: Map<string, string>): SelectorConfig {
  const configPath = options.get("--config");
  return configPath === undefined ? loadSelectorConfig() : loadSelectorConfigFile(configPath);
}

function resolveTask(options: Map<string, string>): string {
  const inline = options.get("--task");
  if (inline !== undefined) return inline;
  const file = options.get("--task-file");
  if (file !== undefined) return readFileSync(file, "utf8");
  throw new Error("a task is required: pass --task <text> or --task-file <path>");
}

function resolveManual(options: Map<string, string>): string[] {
  const raw = options.get("--manual");
  if (raw === undefined || raw === "") return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

const USAGE =
  "usage: horos verify <receipt.json> --graph <graph.json> (--task <text> | --task-file <path>) " +
  "[--config <config.json>] [--manual a,b] [--repo <dir>]";

function runVerifyCommand(argv: readonly string[]): CliResult {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    return { code: 2, lines: [`error: ${(error as Error).message}`, USAGE] };
  }

  const receiptPath = flags.positional[0];
  const graphPath = flags.options.get("--graph");
  if (receiptPath === undefined || graphPath === undefined) {
    return { code: 2, lines: ["error: receipt path and --graph are required", USAGE] };
  }

  let receipt: Receipt;
  let inputs: ReplayInputs;
  try {
    receipt = asReceipt(readJson(receiptPath));
    const repoRoot = flags.options.get("--repo");
    inputs = {
      graph: readJson(graphPath),
      taskText: resolveTask(flags.options),
      config: resolveConfig(flags.options),
      manualInclude: resolveManual(flags.options),
      ...(repoRoot !== undefined ? { repoRoot } : {}),
    };
  } catch (error) {
    return { code: 2, lines: [`error: ${(error as Error).message}`] };
  }

  const outcome = verifyReceipt(receipt, inputs);
  if (outcome.pass) {
    return { code: 0, lines: [`PASS ${receipt.receipt_hash}`] };
  }
  return { code: 1, lines: [`FAIL ${outcome.field}: ${outcome.detail}`] };
}

/** Run the CLI with already-sliced args (no node/script entries). */
export function run(argv: readonly string[]): CliResult {
  const command = argv[0];
  if (command === "verify") {
    return runVerifyCommand(argv.slice(1));
  }
  if (command === undefined || command === "--help" || command === "-h") {
    return { code: command === undefined ? 2 : 0, lines: [USAGE] };
  }
  return { code: 2, lines: [`error: unknown command "${command}"`, USAGE] };
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === `file://${entry}` || import.meta.url.endsWith(entry);
}

if (isMain()) {
  const result = run(process.argv.slice(2));
  const stream = result.code === 0 ? process.stdout : process.stderr;
  stream.write(result.lines.join("\n") + "\n");
  process.exit(result.code);
}
