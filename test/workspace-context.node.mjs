import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { generateGraph } from '../dist/generator/index.js';
import { createContextPack } from '../scripts/workspace_context.mjs';

function fixture(run, source = 'export const authentication = 1;\n') {
  const repo = mkdtempSync(join(tmpdir(), 'horos-pack-'));
  try {
    writeFileSync(join(repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: {}, include: ['*.ts'] }));
    writeFileSync(join(repo, 'auth.ts'), source);
    const { artifact: graph } = generateGraph({ projectRoot: repo,
      tsconfigPath: join(repo, 'tsconfig.json'), repositoryOrigin: 'local:test', commitSha: 'a'.repeat(40) });
    run({ repo, graph, task: 'authentication auth' });
  } finally {
    if (dirname(resolve(repo)) !== resolve(tmpdir())) throw new Error('invalid cleanup path');
    rmSync(repo, { recursive: true, force: true });
  }
}

test('delivers exactly hashed source with replayable receipt under the entire output budget', () => fixture((input) => {
  const result = createContextPack(input);
  assert.equal(result.pack.files.length, 1);
  assert.equal(result.pack.verification.source_hashes, true);
  assert.equal(result.pack.files[0].content, 'export const authentication = 1;\n');
  assert.equal(result.serializedBytes, Buffer.byteLength(result.serialized, 'utf8'));
  assert.ok(result.serializedBytes <= 65536);
  assert.equal(result.pack.selector_config.ranking_strategy.max_files, 12);
  assert.equal(result.pack.selector_config.ranking_strategy.max_depth_hops, 2);
}));

test('rejects edited source after graph generation', () => fixture((input) => {
  writeFileSync(join(input.repo, 'auth.ts'), 'export const authentication = 0;\n');
  assert.throws(() => createContextPack(input), /source hash mismatch/);
}));

test('rejects a large string even though lexical count is tiny', () => fixture((input) => {
  assert.throws(() => createContextPack({ ...input, maxBytes: 4096 }), /byte budget/);
}, `export const authentication = '${'x'.repeat(8000)}';`));

test('counts unicode, JSON escaping and receipt overhead in final cap', () => fixture((input) => {
  const result = createContextPack(input);
  // Leave room for the shorter decimal representation of the budget itself.
  assert.throws(() => createContextPack({ ...input, maxBytes: result.serializedBytes - 128 }), /serialized context/);
}, `export const authentication = '${'é\\n'.repeat(30)}';`));

test('empty selection is partial and gives an actionable warning', () => fixture((input) => {
  const { pack } = createContextPack({ ...input, task: 'xyzzy' });
  assert.equal(pack.selection_status, 'partial');
  assert.equal(pack.files.length, 0);
  assert.match(pack.warnings[0], /No entrypoints/);
}));

test('invalid byte budgets fail before processing', () => fixture((input) => {
  for (const maxBytes of [0, -1, Infinity, NaN, 2.5]) {
    assert.throws(() => createContextPack({ ...input, maxBytes }), /positive safe integer/);
  }
}));
