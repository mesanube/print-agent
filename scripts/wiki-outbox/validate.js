// CLI entry for the outbox pull-request check. Validates every staged
// article and retraction under docs/wiki-outbox/ and exits non-zero
// naming each problem, so a bad article fails the source pull request
// before it can ever reach OS.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listOutboxFiles, validateArticle, validateTombstone } from './outbox.js';

// The CLI lives at scripts/wiki-outbox/validate.js. Two dirname hops only
// reach scripts/, so three are needed to land on the repository root and
// resolve the default outbox to <repo>/docs/wiki-outbox.
const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const outboxDir = process.argv[2] ?? path.join(repoRoot, 'docs', 'wiki-outbox');

if (!fs.existsSync(outboxDir)) {
  process.exit(0);
}

const { articles, retractions } = listOutboxFiles(outboxDir);
const errors = [];
for (const rel of articles) {
  const text = fs.readFileSync(path.join(outboxDir, rel), 'utf8');
  errors.push(...validateArticle(rel, text));
}
for (const rel of retractions) {
  const text = fs.readFileSync(path.join(outboxDir, rel), 'utf8');
  errors.push(...validateTombstone(rel, text));
}

if (errors.length > 0) {
  for (const message of errors) {
    process.stderr.write(`wiki-outbox: ${message}\n`);
  }
  process.exit(1);
}
process.stdout.write(`wiki-outbox: ok (${articles.length} articles, ${retractions.length} retractions)\n`);
