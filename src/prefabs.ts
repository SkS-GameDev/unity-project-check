import path from 'node:path';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { readText } from './project.js';
import { collectFiles, type ScanOptions } from './scan.js';
import { addIssue } from './types.js';

const DOC_HEADER = /^--- !u!(\d+) &-?\d+/gm;
const SOURCE_PREFAB = /^[ \t]*m_SourcePrefab: \{fileID: -?\d+, guid: ([0-9a-f]{32})/gm;
const SCRIPT_REF = /^[ \t]*m_Script: \{fileID: (-?\d+)(?:, guid: ([0-9a-f]{32}))?/gm;
const PREFAB_CLASS_ID = '1001';
const MONOBEHAVIOUR_CLASS_ID = '114';
interface ScanResult {
  file: string;
  sourcePrefabs: { guid: string; offset: number }[];
  scripts: { fileId: string; guid?: string; offset: number }[];
}

function yamlFiles(root: string, options: ScanOptions = {}): string[] {
  return collectFiles(root, ['.prefab', '.unity'], options);
}

function classAt(headers: { offset: number; classId: string }[], offset: number): string {
  let low = 0;
  let high = headers.length - 1;
  let found = '';
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (headers[middle].offset <= offset) {
      found = headers[middle].classId;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function scanFile(file: string): ScanResult {
  const result: ScanResult = { file, sourcePrefabs: [], scripts: [] };
  const text = readText(file);
  const headers: { offset: number; classId: string }[] = [];
  for (const match of text.matchAll(DOC_HEADER)) headers.push({ offset: match.index ?? 0, classId: match[1] });
  for (const match of text.matchAll(SOURCE_PREFAB)) {
    const offset = match.index ?? 0;
    if (classAt(headers, offset) === PREFAB_CLASS_ID) result.sourcePrefabs.push({ guid: match[1], offset });
  }
  for (const match of text.matchAll(SCRIPT_REF)) {
    const offset = match.index ?? 0;
    if (classAt(headers, offset) === MONOBEHAVIOUR_CLASS_ID) result.scripts.push({ fileId: match[1], guid: match[2], offset });
  }
  return result;
}

export function validatePrefabs(root: string, guidIndex: Map<string, string>, options: ScanOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const scans = yamlFiles(root, options).map(scanFile);

  const edges = new Map<string, string[]>();
  for (const scan of scans) {
    if (!scan.file.endsWith('.prefab')) continue;
    const targets: string[] = [];
    for (const source of scan.sourcePrefabs) {
      const target = guidIndex.get(source.guid);
      const start = source.offset;
      if (!target) {
        addIssue(issues, scan.file, start, start + 1, `Source prefab GUID ${source.guid} was not found`, DiagnosticSeverity.Warning, 'prefab-source-missing');
        continue;
      }
      if (!target.endsWith('.prefab')) {
        addIssue(issues, scan.file, start, start + 1, `Source prefab GUID ${source.guid} points to ${path.basename(target)}`, DiagnosticSeverity.Warning, 'prefab-source-type');
        continue;
      }
      targets.push(path.resolve(target));
    }
    edges.set(path.resolve(scan.file), targets);
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(node)), node].map((file) => path.basename(file));
      addIssue(issues, node, 0, 1, `Nested prefab cycle: ${cycle.join(' -> ')}`, DiagnosticSeverity.Error, 'prefab-cycle');
      return;
    }
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (edges.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 'done');
  };
  for (const node of edges.keys()) visit(node);

  for (const scan of scans) {
    for (const script of scan.scripts) {
      const start = script.offset;
      if (script.fileId === '0') {
        addIssue(issues, scan.file, start, start + 1, 'MonoBehaviour has no script (m_Script: {fileID: 0})', DiagnosticSeverity.Warning, 'prefab-missing-script');
        continue;
      }
      if (script.guid && !guidIndex.has(script.guid)) {
        addIssue(issues, scan.file, start, start + 1, `Script GUID ${script.guid} was not found`, DiagnosticSeverity.Warning, 'prefab-missing-script');
      }
    }
  }
  return aggregate(issues);
}

function aggregate(issues: Issue[]): Issue[] {
  const grouped = new Map<string, { issue: Issue; count: number }>();
  for (const issue of issues) {
    const key = `${issue.file}\u0000${issue.code ?? ''}`;
    const existing = grouped.get(key);
    if (existing) existing.count++;
    else grouped.set(key, { issue, count: 1 });
  }
  return [...grouped.values()].map(({ issue, count }) =>
    count > 1 ? { ...issue, message: `${issue.message} (+${count - 1} more)` } : issue
  );
}
