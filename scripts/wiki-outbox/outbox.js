// Validation for docs/wiki-outbox/, the transit staging area for wiki articles.
// Authors write customer-facing docs here in the same pull request as the code;
// on merge, the publish workflow opens a pull request against OS carrying them.
// Nothing here is durable: the outbox is cleared on every successful publish.

import fs from 'node:fs';
import path from 'node:path';

const ARTICLE_KEYS = ['title', 'updated', 'audience', 'payload_slug'];
const OUTBOX_PRODUCT_PREFIX = 'product/';
const RETRACT_DIR = '_retract';

// Split a markdown document into its YAML frontmatter (flat key/value pairs)
// and the remaining body. Returns empty frontmatter when no block is present.
export function parseDocument(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: text };
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) {
    return { frontmatter: {}, body: text };
  }
  const frontmatter = {};
  for (const line of lines.slice(1, end)) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, body: lines.slice(end + 1).join('\n') };
}

// Identity is the wiki path under wiki/product/ minus the extension
// (KTD2). The outbox mirrors the wiki shape, so product/features/x.md
// in the outbox means wiki/product/features/x.md with slug features/x.
export function deriveIdentity(outboxRelPath) {
  const withoutPrefix = outboxRelPath.startsWith(OUTBOX_PRODUCT_PREFIX)
    ? outboxRelPath.slice(OUTBOX_PRODUCT_PREFIX.length)
    : outboxRelPath;
  return withoutPrefix.replace(/\.md$/, '');
}

export function mapToWikiPath(outboxRelPath) {
  return `wiki/${outboxRelPath}`;
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// Market content never reaches the public site (R4). Catch it at the source
// pull request instead of letting it travel to OS first.
function findMarketReferences(body) {
  return body
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.includes('market/'))
    .map(({ line, number }) => `line ${number}: ${line}`);
}

export function validateArticle(outboxRelPath, text) {
  const errors = [];
  if (!outboxRelPath.endsWith('.md')) {
    errors.push(`not a markdown article: ${outboxRelPath}`);
    return errors;
  }
  if (!outboxRelPath.startsWith(OUTBOX_PRODUCT_PREFIX)) {
    errors.push(
      `outbox articles must live under ${OUTBOX_PRODUCT_PREFIX} mirroring wiki/product/; ` +
        `market content is edited directly in OS, never staged here: ${outboxRelPath}`,
    );
    return errors;
  }
  const { frontmatter, body } = parseDocument(text);
  if (Object.keys(frontmatter).length === 0) {
    errors.push(`missing frontmatter block: ${outboxRelPath}`);
    return errors;
  }
  for (const key of ARTICLE_KEYS) {
    if (!frontmatter[key]) {
      errors.push(`missing required frontmatter key '${key}': ${outboxRelPath}`);
    }
  }
  if (frontmatter.audience && frontmatter.audience !== 'cliente') {
    errors.push(
      `audience must be 'cliente' so the article reaches the public site; ` +
        `without it the sync silently skips the file: ${outboxRelPath}`,
    );
  }
  const identity = deriveIdentity(outboxRelPath);
  if (frontmatter.payload_slug && frontmatter.payload_slug !== identity) {
    errors.push(
      `payload_slug '${frontmatter.payload_slug}' disagrees with the path-derived identity ` +
        `'${identity}': ${outboxRelPath}`,
    );
  }
  if (frontmatter.updated && !isCalendarDate(frontmatter.updated)) {
    errors.push(`updated must be a YYYY-MM-DD calendar date: ${outboxRelPath}`);
  }
  for (const reference of findMarketReferences(body)) {
    errors.push(`body reaches into wiki/market/, which never syncs to Payload: ${reference}`);
  }
  return errors;
}

// A retraction proposes removing an article from the wiki (F3). The curator
// reviews it like any other change; the file only names the identity.
export function validateTombstone(outboxRelPath, text) {
  const errors = [];
  if (!outboxRelPath.startsWith(`${RETRACT_DIR}/`)) {
    errors.push(`retractions must live under ${RETRACT_DIR}/: ${outboxRelPath}`);
  }
  const { frontmatter } = parseDocument(text);
  if (Object.keys(frontmatter).length === 0) {
    errors.push(`missing frontmatter block: ${outboxRelPath}`);
    return errors;
  }
  if (!frontmatter.payload_slug) {
    errors.push(`missing required frontmatter key 'payload_slug': ${outboxRelPath}`);
  }
  if (!frontmatter.reason) {
    errors.push(`missing required frontmatter key 'reason': ${outboxRelPath}`);
  }
  return errors;
}

// List staged files, split by kind. The outbox README is convention docs,
// not content, so it is skipped.
export function listOutboxFiles(rootDir) {
  const articles = [];
  const retractions = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.md') || entry.name === 'README.md') {
        continue;
      }
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      if (rel === 'README.md' || rel.endsWith('/README.md')) {
        continue;
      }
      if (rel.startsWith(`${RETRACT_DIR}/`)) {
        retractions.push(rel);
      } else {
        articles.push(rel);
      }
    }
  };
  walk(rootDir);
  articles.sort();
  retractions.sort();
  return { articles, retractions };
}
