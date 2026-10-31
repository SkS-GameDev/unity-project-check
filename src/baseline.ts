import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface BaselineRow {
  file: string;
  code?: string;
  message: string;
}

export function fingerprint(file: string, code: string | undefined, message: string): string {
  return `${file}\u0000${code ?? ''}\u0000${message}`;
}

export function readBaseline(file: string): Set<string> {
  if (!existsSync(file)) return new Set();
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { issues?: BaselineRow[] };
    const rows = Array.isArray(data.issues) ? data.issues : [];
    return new Set(rows.map((row) => fingerprint(row.file, row.code, row.message)));
  } catch {
    return new Set();
  }
}

export function writeBaseline(
  file: string,
  root: string,
  rows: { file: string; code?: string; message: string }[]
): void {
  const issues = rows
    .map((row) => ({ file: path.relative(root, row.file), code: row.code, message: row.message }))
    .sort((left, right) => (left.file + left.message).localeCompare(right.file + right.message));
  const unique = new Map<string, BaselineRow>();
  for (const issue of issues) unique.set(fingerprint(issue.file, issue.code, issue.message), issue);
  writeFileSync(file, JSON.stringify({ version: 1, issues: [...unique.values()] }, null, 2) + '\n');
}
