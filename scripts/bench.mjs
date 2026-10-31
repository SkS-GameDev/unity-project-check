#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = process.argv[2] ?? process.cwd();
const budgetMs = Number(process.env.UNITY_CHECK_BUDGET_MS ?? 30_000);
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'unity-project-check.js');
const started = Date.now();
const result = spawnSync(process.execPath, [cli, '--project', project, '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const elapsed = Date.now() - started;
if (result.status !== 0 && result.status !== 1) {
  console.error(result.stderr || `unity-project-check exited with ${result.status}`);
  process.exit(2);
}
const report = JSON.parse(result.stdout);
console.log(`${elapsed} ms, ${report.errors} error(s), ${report.warnings} warning(s), budget ${budgetMs} ms`);
process.exit(elapsed > budgetMs ? 1 : 0);
