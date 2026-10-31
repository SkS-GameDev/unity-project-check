import { isScalar, isSeq, parseAllDocuments, parseDocument } from 'yaml';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { addIssue } from './types.js';

export interface Span {
  start: number;
  end: number;
}

// Unity writes multi-line single-quoted scalars with the closing quote at column 0,
// which is not valid YAML; folding those newlines to spaces keeps offsets stable.
// shortcut: a content line that is exactly "'" ends the scalar early, upgrade if it shows up.
function endsWithClosingQuote(value: string): boolean {
  const trailing = /'*$/.exec(value)?.[0].length ?? 0;
  return trailing % 2 === 1;
}

export function sanitizeUnityYaml(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /:\s*'(.*)$/.exec(lines[i]);
    if (!match || endsWithClosingQuote(match[1])) {
      out.push(lines[i]);
      continue;
    }
    let end = i + 1;
    while (end < lines.length) {
      if (endsWithClosingQuote(lines[end].trimEnd())) break;
      end++;
    }
    if (end >= lines.length) {
      out.push(lines[i]);
      continue;
    }
    out.push(lines.slice(i, end + 1).join(' '));
    i = end;
  }
  return out.join('\n');
}

export function parseUnityYaml(text: string) {
  return parseDocument(sanitizeUnityYaml(text.replace(/^\uFEFF/, '')), { logLevel: 'error' });
}

export function parseUnityYamlAll(text: string) {
  return parseAllDocuments(sanitizeUnityYaml(text.replace(/^\uFEFF/, '')), { logLevel: 'error' });
}

export function spanOf(node: unknown): Span | undefined {
  const range = (node as { range?: [number, number, number] } | undefined)?.range;
  return range ? { start: range[0], end: range[1] } : undefined;
}

export function stringValue(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined;
}

export function stringsOf(node: unknown): { value: string; span?: Span }[] {
  if (!isSeq(node)) return [];
  return node.items.map((item) => ({ value: stringValue(item) ?? '', span: spanOf(item) }));
}

export function rawScalar(text: string, node: unknown): string | undefined {
  if (!isScalar(node)) return undefined;
  const span = spanOf(node);
  if (!span) return node.value === null || node.value === undefined ? undefined : String(node.value);
  return text.slice(span.start, span.end).trim();
}

export function mapGuid(node: unknown, text: string): string | undefined {
  if (!node || typeof node !== 'object' || !('get' in node)) return undefined;
  return rawScalar(text, (node as { get(key: string, keepScalar: true): unknown }).get('guid', true))?.toLowerCase();
}

export function collectYamlErrors(issues: Issue[], file: string, doc: ReturnType<typeof parseUnityYaml>, code: string): void {
  for (const error of doc.errors) {
    addIssue(issues, file, error.pos[0], error.pos[1], `YAML: ${error.message.split('\n')[0]}`, DiagnosticSeverity.Error, code);
  }
}
