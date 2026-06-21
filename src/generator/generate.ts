/**
 * TypeScript/JavaScript dependency graph generator — SPEC §4 producer side.
 *
 * Walks a TS/JS project and emits a conformant graph artifact. Module resolution
 * is delegated to the TypeScript resolver (tsconfig `paths`/`baseUrl`) as a
 * pre-step — no native reimplementation and no live language server. Unresolved
 * edges are emitted as first-class members of the edge list with the correct
 * `resolution_error` code; they are never dropped (decision 9). The artifact is
 * validated through the PR 1 loader before return, so generator and router agree.
 */

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";

import { sha256, treeHash } from "../canonical/index.js";
import type { ResolutionError } from "../enums.js";
import { SchemaValidationError } from "../errors.js";
import { loadGraphArtifact, type LoadedGraph } from "../graph/index.js";

export const GENERATOR_NAME = "@horos/graph-gen-typescript";
export const GENERATOR_VERSION = "0.1.0";

export type GenerateOptions = {
  /** Project root (also the path prefix that node keys are relative to). */
  readonly projectRoot: string;
  /** tsconfig path; resolved for compiler options and the file set. */
  readonly tsconfigPath: string;
  readonly repositoryOrigin: string;
  readonly commitSha: string;
  /** Tracked files for §2.3 tree_hash; defaults to the indexed source paths. */
  readonly trackedFiles?: readonly string[];
  readonly generatedAt?: string;
  readonly commandExecuted?: string;
  readonly executionMode?: string;
};

type RawResolvedEdge = {
  source: string;
  target: string;
  type: string;
  resolved: true;
  line: number;
};
type RawUnresolvedEdge = {
  source: string;
  target: null;
  type: string;
  resolved: false;
  raw_specifier: string;
  resolution_error: ResolutionError;
  line: number;
};
type RawEdge = RawResolvedEdge | RawUnresolvedEdge;

type RawNode = {
  file_path: string;
  language: string;
  content_hash: string;
  token_count: number;
  exports?: string[];
};

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function relKey(projectRoot: string, absFile: string): string {
  return toPosix(relative(projectRoot, absFile));
}

function languageOf(path: string): string {
  if (/\.(tsx)$/.test(path)) return "tsx";
  if (/\.(ts|mts|cts)$/.test(path)) return "ts";
  if (/\.(jsx)$/.test(path)) return "jsx";
  return "js";
}

function countTokens(text: string): number {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    ts.LanguageVariant.Standard,
    text,
  );
  let count = 0;
  for (let tok = scanner.scan(); tok !== ts.SyntaxKind.EndOfFileToken; tok = scanner.scan()) {
    count += 1;
  }
  return count;
}

function collectExports(sf: ts.SourceFile): string[] {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) names.add(el.name.text);
    } else if (ts.isExportAssignment(node)) {
      names.add("default");
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const isDefault = node.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (isDefault) names.add("default");
      else if (node.name) names.add(node.name.text);
    } else if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...names].sort();
}

function classifyUnresolved(specifier: string, aliasPrefixes: readonly string[]): ResolutionError {
  if (aliasPrefixes.some((p) => specifier === p || specifier.startsWith(`${p}/`))) {
    return "alias_not_found";
  }
  if (specifier.startsWith(".") || specifier.startsWith("/")) return "module_not_found";
  return "external_boundary";
}

function aliasPrefixesFrom(options: ts.CompilerOptions): string[] {
  const paths = options.paths ?? {};
  return Object.keys(paths).map((key) => key.replace(/\/\*$/, "").replace(/\*$/, ""));
}

export function generateGraph(options: GenerateOptions): LoadedGraph {
  const projectRoot = resolve(options.projectRoot);
  const configPath = resolve(options.tsconfigPath);

  const configText = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configText.error !== undefined) {
    throw new SchemaValidationError(
      `cannot read tsconfig ${configPath}: ${ts.flattenDiagnosticMessageText(configText.error.messageText, "\n")}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    configText.config,
    ts.sys,
    projectRoot,
    undefined,
    configPath,
  );
  const compilerOptions = parsed.options;
  const aliasPrefixes = aliasPrefixesFrom(compilerOptions);

  const sourceFiles = parsed.fileNames
    .map((f) => resolve(f))
    .filter((f) => SOURCE_EXT.test(f) && !f.includes("/node_modules/") && !/\.d\.ts$/.test(f))
    .filter((f) => toPosix(f).startsWith(toPosix(projectRoot)))
    .sort();
  const projectFileSet = new Set(sourceFiles.map((f) => relKey(projectRoot, f)));

  const nodes: Record<string, RawNode> = {};
  const edges: RawEdge[] = [];

  for (const absFile of sourceFiles) {
    const sourceRel = relKey(projectRoot, absFile);
    const text = readFileSync(absFile, "utf8");
    const sf = ts.createSourceFile(absFile, text, ts.ScriptTarget.Latest, true);

    const node: RawNode = {
      file_path: sourceRel,
      language: languageOf(absFile),
      content_hash: sha256(readFileSync(absFile)),
      token_count: countTokens(text),
    };
    const exports = collectExports(sf);
    if (exports.length > 0) node.exports = exports;
    nodes[sourceRel] = node;

    const lineOf = (n: ts.Node): number =>
      sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const addSpecifier = (specifier: string, type: string, line: number): void => {
      const res = ts.resolveModuleName(specifier, absFile, compilerOptions, ts.sys);
      const resolved = res.resolvedModule;
      if (resolved !== undefined) {
        const targetRel = relKey(projectRoot, resolve(resolved.resolvedFileName));
        const isExternal =
          resolved.isExternalLibraryImport === true ||
          resolved.resolvedFileName.includes("/node_modules/") ||
          !projectFileSet.has(targetRel);
        if (isExternal) {
          edges.push({
            source: sourceRel,
            target: null,
            type,
            resolved: false,
            raw_specifier: specifier,
            resolution_error: "external_boundary",
            line,
          });
        } else {
          edges.push({ source: sourceRel, target: targetRel, type, resolved: true, line });
        }
        return;
      }
      edges.push({
        source: sourceRel,
        target: null,
        type,
        resolved: false,
        raw_specifier: specifier,
        resolution_error: classifyUnresolved(specifier, aliasPrefixes),
        line,
      });
    };

    const addUnresolvedSyntax = (
      raw: string,
      type: string,
      code: ResolutionError,
      line: number,
    ): void => {
      edges.push({
        source: sourceRel,
        target: null,
        type,
        resolved: false,
        raw_specifier: raw,
        resolution_error: code,
        line,
      });
    };

    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        addSpecifier(n.moduleSpecifier.text, "STATIC_IMPORT", lineOf(n));
      } else if (
        ts.isExportDeclaration(n) &&
        n.moduleSpecifier !== undefined &&
        ts.isStringLiteral(n.moduleSpecifier)
      ) {
        addSpecifier(n.moduleSpecifier.text, "RE_EXPORT", lineOf(n));
      } else if (ts.isCallExpression(n)) {
        if (n.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const arg = n.arguments[0];
          if (arg !== undefined && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
            addSpecifier(arg.text, "DYNAMIC_IMPORT", lineOf(n));
          } else if (arg !== undefined && ts.isTemplateExpression(arg)) {
            addUnresolvedSyntax(arg.getText(sf), "DYNAMIC_IMPORT", "dynamic_template_literal", lineOf(n));
          } else {
            addUnresolvedSyntax(
              arg !== undefined ? arg.getText(sf) : "",
              "DYNAMIC_IMPORT",
              "unsupported_syntax",
              lineOf(n),
            );
          }
        } else if (ts.isIdentifier(n.expression) && n.expression.text === "require") {
          const arg = n.arguments[0];
          if (arg !== undefined && ts.isStringLiteral(arg)) {
            addSpecifier(arg.text, "STATIC_IMPORT", lineOf(n));
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const nodePaths = Object.keys(nodes).sort();
  const trackedFiles = options.trackedFiles ?? nodePaths;
  const unresolvedCount = edges.filter((e) => !e.resolved).length;

  const artifact = {
    $schema: "context-graph-v0",
    metadata: {
      generator: {
        name: GENERATOR_NAME,
        version: GENERATOR_VERSION,
        command_executed: options.commandExecuted ?? `graph-gen --project ${options.tsconfigPath}`,
        execution_mode: options.executionMode ?? "ci",
      },
      provenance: {
        repository_origin: options.repositoryOrigin,
        commit_sha: options.commitSha,
        tree_hash: treeHash(trackedFiles),
        generated_at: options.generatedAt ?? new Date().toISOString(),
      },
      resolver_stack: [{ name: "typescript", version: ts.version }],
      coverage: {
        files_total: nodePaths.length,
        files_indexed: nodePaths.length,
        edges_total: edges.length,
        unresolved_edges: unresolvedCount,
      },
      completeness: unresolvedCount > 0 ? "partial" : "complete",
    },
    nodes,
    edges,
  };

  // Validate our own output through the router's loader so the two always agree.
  return loadGraphArtifact(artifact);
}
