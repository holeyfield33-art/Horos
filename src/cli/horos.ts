#!/usr/bin/env node
/**
 * `horos` CLI — context-graph generation, routing, and receipt verification.
 *
 *   horos generate --tsconfig <path> [--repo <dir>] [--origin <url>]
 *       [--commit <sha>] [--out <file>] [--json]
 *
 *   horos route <graph.json> <task text> [--key <hex-seed>] [--out <file>]
 *       [--config <config.json>] [--manual a.ts,b.ts] [--json]
 *
 *   horos verify <receipt.json> --graph <graph.json> --task <text>
 *       [--task-file <file>] [--config <config.json>]
 *       [--manual a.ts,b.ts] [--repo <dir>]
 *
 * Exit codes: 0 success, 1 operation failure (FAIL / generation error), 2 usage error.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { KeyObject } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  generateEd25519KeyPair,
  ed25519PrivateKeyFromSeed,
  ed25519PublicKeyFromPrivate,
  ed25519PublicKeyToHex,
} from "../canonical/index.js";
import { loadSelectorConfig, loadSelectorConfigFile, type SelectorConfig } from "../config/index.js";
import { generateGraph } from "../generator/index.js";
import { loadGraphArtifact } from "../graph/index.js";
import { selectContext } from "../pipeline/index.js";
import { buildReceipt } from "../receipt/index.js";
import type { Receipt } from "../receipt/index.js";
import { verifyReceipt, type ReplayInputs } from "../verify/index.js";

export type CliResult = { readonly code: number; readonly lines: readonly string[] };

type Flags = {
  readonly positional: string[];
  readonly options: Map<string, string>;
  readonly booleans: Set<string>;
};

const VALUE_FLAGS = new Set([
  "--graph",
  "--task",
  "--task-file",
  "--config",
  "--manual",
  "--repo",
  "--tsconfig",
  "--origin",
  "--commit",
  "--out",
  "--key",
  "--trusted-key",
]);

const BOOLEAN_FLAGS = new Set(["--json"]);

function parseFlags(argv: readonly string[]): Flags {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      options.set(arg, value);
      i += 1;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      booleans.add(arg);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, options, booleans };
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

function writeOutput(path: string | undefined, content: string): CliResult {
  if (path !== undefined) {
    writeFileSync(path, content, "utf8");
    return { code: 0, lines: [] };
  }
  return { code: 0, lines: [content] };
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

const GENERATE_USAGE =
  "usage: horos generate --tsconfig <path> [--repo <dir>] [--origin <url>] " +
  "[--commit <sha>] [--out <file>] [--json]";

function runGenerateCommand(argv: readonly string[]): CliResult {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    return { code: 2, lines: [`error: ${(error as Error).message}`, GENERATE_USAGE] };
  }

  const tsconfigArg = flags.options.get("--tsconfig");
  if (tsconfigArg === undefined) {
    return { code: 2, lines: ["error: --tsconfig is required", GENERATE_USAGE] };
  }

  const resolvedTsconfig = resolve(tsconfigArg);
  const projectRoot = resolve(flags.options.get("--repo") ?? dirname(resolvedTsconfig));
  const origin = flags.options.get("--origin") ?? `local:${projectRoot}`;
  const outPath = flags.options.get("--out");
  const useJson = flags.booleans.has("--json");

  let commitSha = flags.options.get("--commit");
  if (commitSha === undefined) {
    try {
      commitSha = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
    } catch {
      commitSha = "0000000000000000000000000000000000000000";
    }
  }

  let artifact: unknown;
  try {
    ({ artifact } = generateGraph({
      projectRoot,
      tsconfigPath: resolvedTsconfig,
      repositoryOrigin: origin,
      commitSha,
    }));
  } catch (error) {
    return { code: 1, lines: [`error: ${(error as Error).message}`] };
  }

  const json = useJson
    ? JSON.stringify({ ok: true, graph: artifact }, null, 2)
    : JSON.stringify(artifact, null, 2);

  return writeOutput(outPath, json);
}

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------

const ROUTE_USAGE =
  "usage: horos route <graph.json> <task text...> [--key <hex-seed>] [--out <file>] " +
  "[--config <config.json>] [--manual a,b] [--json]";

function runRouteCommand(argv: readonly string[]): CliResult {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    return { code: 2, lines: [`error: ${(error as Error).message}`, ROUTE_USAGE] };
  }

  const graphPath = flags.positional[0];
  const taskText = flags.positional.slice(1).join(" ");
  if (graphPath === undefined || taskText === "") {
    return { code: 2, lines: ["error: graph path and task text are required", ROUTE_USAGE] };
  }

  const outPath = flags.options.get("--out");
  const useJson = flags.booleans.has("--json");

  let rawGraph: unknown;
  let config: SelectorConfig;
  try {
    rawGraph = readJson(graphPath);
    config = resolveConfig(flags.options);
  } catch (error) {
    return { code: 2, lines: [`error: ${(error as Error).message}`] };
  }

  let artifact: ReturnType<typeof loadGraphArtifact>["artifact"];
  let graphArtifactHash: string;
  try {
    ({ artifact, graphArtifactHash } = loadGraphArtifact(rawGraph));
  } catch (error) {
    return { code: 1, lines: [`error: ${(error as Error).message}`] };
  }

  const selectionResult = selectContext({ graph: artifact, task: taskText, config });

  let privateKey: KeyObject;
  const keySeed = flags.options.get("--key");
  if (keySeed !== undefined) {
    try {
      privateKey = ed25519PrivateKeyFromSeed(keySeed);
    } catch (error) {
      return { code: 2, lines: [`error: invalid --key: ${(error as Error).message}`] };
    }
  } else {
    ({ privateKey } = generateEd25519KeyPair());
    const pubHex = ed25519PublicKeyToHex(ed25519PublicKeyFromPrivate(privateKey));
    process.stderr.write(`public_key: ${pubHex}\n`);
  }

  let receipt: Receipt;
  try {
    receipt = buildReceipt({
      selectionResult,
      repository: {
        origin: artifact.metadata.provenance.repository_origin,
        commit_sha: artifact.metadata.provenance.commit_sha,
        tree_hash: artifact.metadata.provenance.tree_hash,
      },
      taskText,
      taskClass: "feature",
      config,
      graphArtifactHash,
      graphGenerator: {
        name: artifact.metadata.generator.name,
        version: artifact.metadata.generator.version,
      },
      manualInclude: resolveManual(flags.options),
      prevReceiptHash: null,
      privateKey,
    });
  } catch (error) {
    return { code: 1, lines: [`error: ${(error as Error).message}`] };
  }

  const json = useJson
    ? JSON.stringify({ ok: true, receipt }, null, 2)
    : JSON.stringify(receipt, null, 2);

  return writeOutput(outPath, json);
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

const VERIFY_USAGE =
  "usage: horos verify <receipt.json> --graph <graph.json> (--task <text> | --task-file <path>) " +
  "[--config <config.json>] [--manual a,b] [--repo <dir>]";

function runVerifyCommand(argv: readonly string[]): CliResult {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    return { code: 2, lines: [`error: ${(error as Error).message}`, VERIFY_USAGE] };
  }

  const receiptPath = flags.positional[0];
  const graphPath = flags.options.get("--graph");
  if (receiptPath === undefined || graphPath === undefined) {
    return { code: 2, lines: ["error: receipt path and --graph are required", VERIFY_USAGE] };
  }

  let receipt: Receipt;
  let inputs: ReplayInputs;
  try {
    receipt = asReceipt(readJson(receiptPath));
    const repoRoot = flags.options.get("--repo");
    const expectedPublicKey = flags.options.get("--trusted-key");
    inputs = {
      graph: readJson(graphPath),
      taskText: resolveTask(flags.options),
      config: resolveConfig(flags.options),
      manualInclude: resolveManual(flags.options),
      ...(repoRoot !== undefined ? { repoRoot } : {}),
      ...(expectedPublicKey !== undefined ? { expectedPublicKey } : {}),
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

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

const USAGE =
  "usage: horos <command> [...args]\n" +
  "  horos generate --tsconfig <path> [--repo <dir>] [--origin <url>] [--commit <sha>] [--out <file>] [--json]\n" +
  "  horos route <graph.json> <task text...> [--key <hex-seed>] [--out <file>] [--config <config.json>] [--manual a,b] [--json]\n" +
  "  horos verify <receipt.json> --graph <graph.json> (--task <text> | --task-file <path>) [--config <config.json>] [--manual a,b] [--repo <dir>]";

/** Run the CLI with already-sliced args (no node/script entries). */
export function run(argv: readonly string[]): CliResult {
  const command = argv[0];
  if (command === "generate") {
    return runGenerateCommand(argv.slice(1));
  }
  if (command === "route") {
    return runRouteCommand(argv.slice(1));
  }
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
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMain()) {
  const result = run(process.argv.slice(2));
  if (result.lines.length > 0) {
    const stream = result.code === 0 ? process.stdout : process.stderr;
    stream.write(result.lines.join("\n") + "\n");
  }
  process.exit(result.code);
}

