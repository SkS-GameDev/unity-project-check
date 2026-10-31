import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';

export interface Row {
  file: string;
  line: number;
  column: number;
  severity: string;
  message: string;
  code?: string;
}

const textCache = new Map<string, string>();

function lineColumn(file: string, offset: number): { line: number; column: number } {
  let text = textCache.get(file);
  if (text === undefined) {
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      text = '';
    }
    textCache.set(file, text);
  }
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function severityName(severity: DiagnosticSeverity): string {
  if (severity === DiagnosticSeverity.Error) return 'error';
  if (severity === DiagnosticSeverity.Warning) return 'warning';
  if (severity === DiagnosticSeverity.Information) return 'info';
  return 'hint';
}

export function toRow(issue: Issue): Row {
  const position = lineColumn(issue.file, issue.start);
  return {
    file: issue.file,
    line: position.line,
    column: position.column,
    severity: severityName(issue.severity),
    message: issue.message,
    code: issue.code,
  };
}

export function countRows(rows: Row[]): { errors: number; warnings: number } {
  return {
    errors: rows.filter((row) => row.severity === 'error').length,
    warnings: rows.filter((row) => row.severity === 'warning').length,
  };
}

export function printRows(root: string, rows: Row[], baselined: number): void {
  for (const row of rows) {
    console.log(`${row.severity} ${path.relative(root, row.file)}:${row.line}:${row.column} ${row.message}`);
  }
  const { errors, warnings } = countRows(rows);
  const suffix = baselined > 0 ? `, ${baselined} baselined` : '';
  console.log(`${errors} error(s), ${warnings} warning(s)${suffix} in ${root}`);
}
