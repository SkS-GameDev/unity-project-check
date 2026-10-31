#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const roots = process.argv.slice(2);
const targets = roots.length > 0 ? roots : ['.'];
const ignored = new Set(['node_modules', 'out', '.git', 'coverage']);
const patterns = [
  [/sk-[A-Za-z0-9]{16,}/, 'API key'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b(password|passwd|secret)\s*[:=]\s*\S+/i, 'credential assignment'],
  [/\b[\w-]+\.(?:internal|corp)\b/i, 'corporate host'],
  [/192\.168\.\d+\.\d+/, 'private network address'],
];
const binary = /\.(png|jpg|jpeg|gif|ico|zip|gz|tgz|pdf|woff2?|ttf|eot|bin|dll|exe|so|dylib)$/i;

let findings = 0;
let scanned = 0;

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile() || binary.test(entry.name) || entry.name === 'audit.mjs') continue;
    const size = statSync(full).size;
    if (size > 2 * 1024 * 1024) continue;
    scanned++;
    const text = readFileSync(full, 'utf8');
    const lines = text.split('\n');
    for (const [pattern, label] of patterns) {
      for (let index = 0; index < lines.length; index++) {
        if (!pattern.test(lines[index]) || lines[index].includes('${{ secrets.')) continue;
        findings++;
        console.log(`${full}:${index + 1}: ${label}: ${lines[index].trim().slice(0, 120)}`);
      }
    }
  }
}

for (const target of targets) walk(target);
console.log(`${findings} finding(s), ${scanned} file(s) scanned`);
process.exit(findings > 0 ? 1 : 0);
