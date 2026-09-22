import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  deriveIdentity,
  listOutboxFiles,
  mapToWikiPath,
  parseDocument,
  validateArticle,
  validateTombstone,
} from './outbox.js';

const VALID_ARTICLE = `---
title: Notas por item
updated: 2026-09-20
audience: cliente
payload_slug: features/notas-por-item
sources: [MES-1234, PR #189]
---

# Notas por item

Carga una indicacion por unidad de cada plato.

## Relacionado

- [Mapa de mesas](mapa-de-mesas.md)
`;

test('valid article passes with no errors', () => {
  const errors = validateArticle('product/features/notas-por-item.md', VALID_ARTICLE);
  assert.deepEqual(errors, []);
});

test('missing required frontmatter keys fail', () => {
  for (const key of ['title', 'updated', 'audience', 'payload_slug']) {
    const lines = VALID_ARTICLE.split('\n');
    const without = lines.filter((line) => !line.startsWith(`${key}:`)).join('\n');
    const errors = validateArticle('product/features/notas-por-item.md', without);
    assert.ok(
      errors.some((message) => message.includes(key)),
      `expected an error naming ${key}, got ${JSON.stringify(errors)}`,
    );
  }
});

test('audience other than cliente fails closed', () => {
  const text = VALID_ARTICLE.replace('audience: cliente', 'audience: interno');
  const errors = validateArticle('product/features/notas-por-item.md', text);
  assert.ok(errors.some((message) => message.includes('audience')));
});

test('payload_slug disagreeing with the path fails', () => {
  const text = VALID_ARTICLE.replace(
    'payload_slug: features/notas-por-item',
    'payload_slug: features/otro-articulo',
  );
  const errors = validateArticle('product/features/notas-por-item.md', text);
  assert.ok(errors.some((message) => message.includes('payload_slug')));
});

test('article outside product/ fails', () => {
  const errors = validateArticle('market/comparativa.md', VALID_ARTICLE);
  assert.ok(errors.length > 0);
});

test('body linking into wiki/market/ is rejected with the line named', () => {
  const text = `${VALID_ARTICLE}\nVer tambien [comparativa](../market/comparativa.md).\n`;
  const errors = validateArticle('product/features/notas-por-item.md', text);
  assert.ok(errors.some((message) => message.includes('market')));
  assert.ok(errors.some((message) => message.includes('comparativa')));
});

test('malformed updated date fails', () => {
  const text = VALID_ARTICLE.replace('updated: 2026-09-20', 'updated: ayer');
  const errors = validateArticle('product/features/notas-por-item.md', text);
  assert.ok(errors.some((message) => message.includes('updated')));
});

test('calendar-impossible updated dates fail', () => {
  for (const badDate of ['2026-02-30', '2026-13-01']) {
    const text = VALID_ARTICLE.replace('updated: 2026-09-20', `updated: ${badDate}`);
    const errors = validateArticle('product/features/notas-por-item.md', text);
    assert.ok(
      errors.some((message) => message.includes('updated')),
      `expected ${badDate} to be rejected as a calendar date`,
    );
  }
});

test('missing frontmatter block fails', () => {
  const errors = validateArticle('product/features/notas-por-item.md', '# Solo un titulo\n');
  assert.ok(errors.length > 0);
});

test('deriveIdentity strips product/ and the extension', () => {
  assert.equal(deriveIdentity('product/features/notas-por-item.md'), 'features/notas-por-item');
  assert.equal(deriveIdentity('product/overview.md'), 'overview');
});

test('mapToWikiPath mirrors the outbox path under wiki/', () => {
  assert.equal(
    mapToWikiPath('product/features/notas-por-item.md'),
    'wiki/product/features/notas-por-item.md',
  );
});

const VALID_TOMBSTONE = `---
payload_slug: features/funcion-eliminada
reason: La funcion se quito en la version 3.2 y el articulo ya no describe nada real.
---
`;

test('valid tombstone passes', () => {
  const errors = validateTombstone('_retract/funcion-eliminada.md', VALID_TOMBSTONE);
  assert.deepEqual(errors, []);
});

test('tombstone missing reason or slug fails', () => {
  const noReason = VALID_TOMBSTONE.split('\n')
    .filter((line) => !line.startsWith('reason:'))
    .join('\n');
  assert.ok(validateTombstone('_retract/x.md', noReason).some((m) => m.includes('reason')));

  const noSlug = VALID_TOMBSTONE.split('\n')
    .filter((line) => !line.startsWith('payload_slug:'))
    .join('\n');
  assert.ok(validateTombstone('_retract/x.md', noSlug).some((m) => m.includes('payload_slug')));
});

test('tombstone payload_slug escaping the wiki tree is rejected', () => {
  for (const slug of ['../escape', '/abs/slug', 'features/x.md']) {
    const text = VALID_TOMBSTONE.replace(
      'payload_slug: features/funcion-eliminada',
      `payload_slug: ${slug}`,
    );
    const errors = validateTombstone('_retract/x.md', text);
    assert.ok(errors.some((m) => m.includes('payload_slug')), `expected ${slug} to be rejected`);
  }
});

test('tombstone payload_slug with a valid nested path passes', () => {
  const text = VALID_TOMBSTONE.replace(
    'payload_slug: features/funcion-eliminada',
    'payload_slug: features/notas-por-item',
  );
  const errors = validateTombstone('_retract/x.md', text);
  assert.deepEqual(errors, []);
});

test('parseDocument splits frontmatter from body', () => {
  const { frontmatter, body } = parseDocument(VALID_ARTICLE);
  assert.equal(frontmatter.title, 'Notas por item');
  assert.equal(frontmatter.payload_slug, 'features/notas-por-item');
  assert.ok(body.includes('## Relacionado'));
});

test('listOutboxFiles separates articles from retractions and skips the README', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'));
  fs.mkdirSync(path.join(root, 'product', 'features'), { recursive: true });
  fs.mkdirSync(path.join(root, '_retract'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), '# Outbox\n');
  fs.writeFileSync(path.join(root, 'product', 'features', 'a.md'), VALID_ARTICLE);
  fs.writeFileSync(path.join(root, '_retract', 'b.md'), VALID_TOMBSTONE);

  const { articles, retractions } = listOutboxFiles(root);
  assert.deepEqual(articles, ['product/features/a.md']);
  assert.deepEqual(retractions, ['_retract/b.md']);

  fs.rmSync(root, { recursive: true, force: true });
});

test('listOutboxFiles skips non-markdown and nested README files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'));
  fs.mkdirSync(path.join(root, 'product', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'product', 'notes.txt'), 'not markdown');
  fs.writeFileSync(path.join(root, 'product', 'features', 'README.md'), '# Doc\n');
  fs.writeFileSync(path.join(root, 'product', 'features', 'a.md'), VALID_ARTICLE);
  fs.writeFileSync(path.join(root, 'product', 'b.md'), VALID_ARTICLE);

  const { articles } = listOutboxFiles(root);
  assert.deepEqual(articles, ['product/b.md', 'product/features/a.md']);

  fs.rmSync(root, { recursive: true, force: true });
});

test('non-markdown path fails validation', () => {
  const errors = validateArticle('product/notes.txt', '# Solo texto\n');
  assert.ok(errors.some((message) => message.includes('not a markdown article')));
});

test('unclosed frontmatter fence fails validation', () => {
  const errors = validateArticle('product/features/x.md', '---\ntitle: Sin cierre\n');
  assert.ok(errors.some((message) => message.includes('missing frontmatter block')));
});

test('tombstone outside _retract/ fails', () => {
  const errors = validateTombstone('product/x.md', VALID_TOMBSTONE);
  assert.ok(errors.some((message) => message.includes('_retract')));
});

test('tombstone with no frontmatter block fails', () => {
  const errors = validateTombstone('_retract/x.md', '# Solo titulo\n');
  assert.ok(errors.some((message) => message.includes('missing frontmatter block')));
});

test('words containing market/ are not flagged as wiki/market references', () => {
  const text = `${VALID_ARTICLE}\nLa distribucion se hace desde supermarket/central.md.\n`;
  const errors = validateArticle('product/features/notas-por-item.md', text);
  assert.deepEqual(errors, []);
});
