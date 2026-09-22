// CLI-level coverage for validate.js, the source-pull-request gate over
// docs/wiki-outbox/. The validator logic itself is unit-tested in
// outbox.test.js; these cases spawn the real CLI so its argument handling,
// default directory, exit codes and output format are exercised end to end.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('./validate.js', import.meta.url));

const VALID_ARTICLE = `---
title: Notas por item
updated: 2026-09-20
audience: cliente
payload_slug: features/notas-por-item
---

# Notas por item

Carga una indicacion por unidad de cada plato.
`;

const VALID_TOMBSTONE = `---
payload_slug: features/funcion-eliminada
reason: La funcion se quito en la version 3.2.
---
`;

function run(dir) {
  return spawnSync(process.execPath, [cliPath, dir], { encoding: 'utf8' });
}

function makeOutbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-outbox-'));
  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('missing directory exits 0', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-outbox-gone-'));
  const missing = path.join(base, 'does-not-exist');
  fs.rmSync(base, { recursive: true, force: true });
  assert.equal(fs.existsSync(missing), false);

  const result = run(missing);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('empty directory reports zero articles and zero retractions', () => {
  const { root, cleanup } = makeOutbox();
  try {
    const result = run(root);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'wiki-outbox: ok (0 articles, 0 retractions)\n');
  } finally {
    cleanup();
  }
});

test('article missing a required frontmatter key fails and names the problem', () => {
  const { root, cleanup } = makeOutbox();
  try {
    const article = VALID_ARTICLE.replace('audience: cliente\n', '');
    fs.mkdirSync(path.join(root, 'product', 'features'), { recursive: true });
    fs.writeFileSync(path.join(root, 'product', 'features', 'notas-por-item.md'), article);

    const result = run(root);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("missing required frontmatter key 'audience'"));
    assert.ok(result.stderr.includes('product/features/notas-por-item.md'));
  } finally {
    cleanup();
  }
});

test('one valid article and one valid tombstone exit 0', () => {
  const { root, cleanup } = makeOutbox();
  try {
    fs.mkdirSync(path.join(root, 'product', 'features'), { recursive: true });
    fs.mkdirSync(path.join(root, '_retract'), { recursive: true });
    fs.writeFileSync(path.join(root, 'product', 'features', 'notas-por-item.md'), VALID_ARTICLE);
    fs.writeFileSync(path.join(root, '_retract', 'funcion-eliminada.md'), VALID_TOMBSTONE);

    const result = run(root);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'wiki-outbox: ok (1 articles, 1 retractions)\n');
  } finally {
    cleanup();
  }
});

test('bare invocation defaults to the repo outbox, not scripts/docs/wiki-outbox', () => {
  // Same three dirname hops as validate.js: the test lives beside it in
  // scripts/wiki-outbox/, so walking up the same amount lands on the repo root.
  const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const expectedDefault = path.join(repoRoot, 'docs', 'wiki-outbox');
  assert.ok(
    fs.existsSync(expectedDefault),
    `the repo outbox must exist for this pin to be meaningful: ${expectedDefault}`,
  );

  const bare = spawnSync(process.execPath, [cliPath], { encoding: 'utf8' });
  const explicit = spawnSync(process.execPath, [cliPath, expectedDefault], { encoding: 'utf8' });

  // A default pointing at scripts/docs/wiki-outbox (the one-dirname-short
  // bug) silently exits 0 on a directory that never exists, so its empty
  // output cannot match the explicit run against the real outbox.
  assert.equal(bare.status, explicit.status);
  assert.equal(bare.stdout, explicit.stdout);
  assert.equal(bare.stderr, explicit.stderr);
});