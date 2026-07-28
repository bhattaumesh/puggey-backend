#!/usr/bin/env node
// Permanent guard against em dashes (—) and en dashes (–) in user-facing copy:
// notification messages, email templates, DTO validation messages, and seed
// data (which doubles as demo copy in this app). Code comments are out of
// scope; see the frontend's scripts/check-dashes.mjs for the same rule and
// its documented heuristics/limitations.
//
// Allow-list a deliberate exception with an inline comment on the same line
// containing "dash-lint-ignore" and why.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['src', 'prisma', 'locales'];
const EXTENSIONS = new Set(['.ts', '.js', '.json']);
const DASH_RE = /[–—]/;
const IGNORE_MARKER = 'dash-lint-ignore';

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === 'migrations') continue;
      walk(full, out);
    } else if (EXTENSIONS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

function checkFile(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const violations = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (raw.includes(IGNORE_MARKER)) continue;

    const codePart = raw.split('//')[0];
    if (DASH_RE.test(codePart)) {
      violations.push({ line: i + 1, text: raw.trim() });
    }
  }
  return violations;
}

const files = ROOTS.flatMap((r) => walk(r));
let total = 0;
for (const file of files) {
  const violations = checkFile(file);
  for (const v of violations) {
    console.error(`${file}:${v.line}: ${v.text}`);
    total++;
  }
}

if (total > 0) {
  console.error(`\n${total} em/en dash occurrence(s) found in user-facing copy.`);
  process.exit(1);
} else {
  console.log('No em or en dashes found in user-facing copy.');
}
