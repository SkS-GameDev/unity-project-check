import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Node } from 'jsonc-parser';
import { findNodeAtLocation, parse, parseTree, printParseErrorCode } from 'jsonc-parser';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { addIssue } from './types.js';
import type { AsmdefIndex, AsmdefInfo } from './project.js';
import { buildIndex, findAsmdefFiles, isAsmdefFile, isAsmrefFile, isIgnoredPath, readText, resolveReference, scanAsmdefs } from './project.js';

const JSON_OPTIONS = { allowTrailingComma: true, disallowComments: false };

function expectString(issues: Issue[], file: string, node: Node | undefined, label: string): string | undefined {
  if (!node) return undefined;
  if (node.type !== 'string') {
    addIssue(issues, file, node.offset, node.offset + node.length, `${label} must be a string`, DiagnosticSeverity.Error, 'asmdef-type');
    return undefined;
  }
  return String(node.value);
}

function expectBoolean(issues: Issue[], file: string, node: Node | undefined, label: string): void {
  if (!node) return;
  if (node.type !== 'boolean') {
    addIssue(issues, file, node.offset, node.offset + node.length, `${label} must be a boolean`, DiagnosticSeverity.Error, 'asmdef-type');
  }
}

function stringArray(issues: Issue[], file: string, node: Node | undefined, label: string): string[] {
  if (!node) return [];
  if (node.type !== 'array') {
    addIssue(issues, file, node.offset, node.offset + node.length, `${label} must be an array`, DiagnosticSeverity.Error, 'asmdef-type');
    return [];
  }
  const values: string[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== 'string') {
      addIssue(issues, file, child.offset, child.offset + child.length, `${label} entries must be strings`, DiagnosticSeverity.Error, 'asmdef-type');
      continue;
    }
    values.push(String(child.value));
  }
  return values;
}

export interface AsmdefValidation {
  issues: Issue[];
  info?: AsmdefInfo;
}

export function validateAsmdef(
  file: string,
  text: string,
  index: AsmdefIndex,
  asmdefs: AsmdefInfo[],
  graph = buildGraph(asmdefs, index)
): AsmdefValidation {
  const issues: Issue[] = [];
  const errors: { offset: number; length: number; error: number }[] = [];
  parse(text, errors, JSON_OPTIONS);
  for (const error of errors) {
    addIssue(issues, file, error.offset, error.offset + error.length, `JSON: ${printParseErrorCode(error.error)}`, DiagnosticSeverity.Error, 'asmdef-json');
  }
  const tree = parseTree(text, errors, JSON_OPTIONS);
  if (!tree) return { issues };

  const nameNode = findNodeAtLocation(tree, ['name']);
  const name = expectString(issues, file, nameNode, 'name');
  if (!name) {
    addIssue(issues, file, nameNode?.offset ?? 0, (nameNode?.offset ?? 0) + (nameNode?.length ?? 1), 'Assembly name is required', DiagnosticSeverity.Error, 'asmdef-name');
  } else {
    const duplicates = index.byName.get(name) ?? [];
    if (duplicates.length > 1) {
      addIssue(issues, file, nameNode!.offset, nameNode!.offset + nameNode!.length, `Assembly name "${name}" is duplicated`, DiagnosticSeverity.Error, 'asmdef-duplicate-name');
    }
  }

  expectString(issues, file, findNodeAtLocation(tree, ['rootNamespace']), 'rootNamespace');
  expectBoolean(issues, file, findNodeAtLocation(tree, ['allowUnsafeCode']), 'allowUnsafeCode');
  expectBoolean(issues, file, findNodeAtLocation(tree, ['overrideReferences']), 'overrideReferences');
  expectBoolean(issues, file, findNodeAtLocation(tree, ['autoReferenced']), 'autoReferenced');
  expectBoolean(issues, file, findNodeAtLocation(tree, ['noEngineReferences']), 'noEngineReferences');
  stringArray(issues, file, findNodeAtLocation(tree, ['includePlatforms']), 'includePlatforms');
  stringArray(issues, file, findNodeAtLocation(tree, ['excludePlatforms']), 'excludePlatforms');
  stringArray(issues, file, findNodeAtLocation(tree, ['precompiledReferences']), 'precompiledReferences');
  stringArray(issues, file, findNodeAtLocation(tree, ['defineConstraints']), 'defineConstraints');

  const versionDefines = findNodeAtLocation(tree, ['versionDefines']);
  if (versionDefines) {
    if (versionDefines.type !== 'array') {
      addIssue(issues, file, versionDefines.offset, versionDefines.offset + versionDefines.length, 'versionDefines must be an array', DiagnosticSeverity.Error, 'asmdef-type');
    } else {
      for (const entry of versionDefines.children ?? []) {
        if (entry.type !== 'object') {
          addIssue(issues, file, entry.offset, entry.offset + entry.length, 'versionDefines entries must be objects', DiagnosticSeverity.Error, 'asmdef-type');
          continue;
        }
        expectString(issues, file, findNodeAtLocation(entry, ['name']), 'versionDefines.name');
        expectString(issues, file, findNodeAtLocation(entry, ['expression']), 'versionDefines.expression');
        expectString(issues, file, findNodeAtLocation(entry, ['define']), 'versionDefines.define');
      }
    }
  }

  const referencesNode = findNodeAtLocation(tree, ['references']);
  const references = stringArray(issues, file, referencesNode, 'references');
  if (referencesNode?.type === 'array') {
    for (const child of referencesNode.children ?? []) {
      if (child.type !== 'string') continue;
      const reference = String(child.value);
      const target = resolveReference(reference, index);
      if (!target) {
        addIssue(
          issues,
          file,
          child.offset,
          child.offset + child.length,
          `Assembly reference "${reference}" was not found`,
          DiagnosticSeverity.Warning,
          'asmdef-unresolved-reference'
        );
        continue;
      }
      if (path.resolve(target.path) === path.resolve(file)) {
        addIssue(issues, file, child.offset, child.offset + child.length, 'Assembly cannot reference itself', DiagnosticSeverity.Error, 'asmdef-self-reference');
      }
    }
  }

  const cycle = findCycle(file, graph);
  if (cycle) {
    addIssue(
      issues,
      file,
      0,
      1,
      `Assembly reference cycle: ${cycle.map((item) => path.basename(item)).join(' -> ')}`,
      DiagnosticSeverity.Error,
      'asmdef-cycle'
    );
  }

  return {
    issues,
    info: name ? { path: file, uri: pathToFileURL(file).toString(), name, guid: undefined, references } : undefined,
  };
}

export function validateAsmref(file: string, text: string, index: AsmdefIndex): Issue[] {
  const issues: Issue[] = [];
  const errors: { offset: number; length: number; error: number }[] = [];
  parse(text, errors, JSON_OPTIONS);
  for (const error of errors) {
    addIssue(issues, file, error.offset, error.offset + error.length, `JSON: ${printParseErrorCode(error.error)}`, DiagnosticSeverity.Error, 'asmref-json');
  }
  const tree = parseTree(text, errors, JSON_OPTIONS);
  if (!tree) return issues;
  const node = findNodeAtLocation(tree, ['reference']);
  const reference = expectString(issues, file, node, 'reference');
  if (!reference) {
    addIssue(issues, file, node?.offset ?? 0, (node?.offset ?? 0) + (node?.length ?? 1), 'Assembly reference is required', DiagnosticSeverity.Error, 'asmref-reference');
  } else if (!resolveReference(reference, index)) {
    addIssue(issues, file, node!.offset, node!.offset + node!.length, `Assembly reference "${reference}" was not found`, DiagnosticSeverity.Error, 'asmref-unresolved');
  }
  return issues;
}

export function buildGraph(asmdefs: AsmdefInfo[], index: AsmdefIndex): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const asmdef of asmdefs) {
    const edges = new Set<string>();
    for (const reference of asmdef.references) {
      const target = resolveReference(reference, index);
      if (target && path.resolve(target.path) !== path.resolve(asmdef.path)) edges.add(path.resolve(target.path));
    }
    graph.set(path.resolve(asmdef.path), edges);
  }
  return graph;
}

export function findCycle(file: string, graph: Map<string, Set<string>>): string[] | undefined {
  const start = path.resolve(file);
  const seen = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): string[] | undefined => {
    const index = stack.indexOf(node);
    if (index >= 0) return [...stack.slice(index), node];
    if (seen.has(node)) return undefined;
    seen.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    return undefined;
  };
  return visit(start);
}

export function validateProject(root: string): Issue[] {
  const asmdefs = scanAsmdefs(root);
  const index = buildIndex(asmdefs);
  const graph = buildGraph(asmdefs, index);
  const issues: Issue[] = [];
  for (const file of findAsmdefFiles(root)) {
    try {
      issues.push(...validateAsmdef(file, readText(file), index, asmdefs, graph).issues);
    } catch {
      addIssue(issues, file, 0, 1, 'Unable to read assembly definition', DiagnosticSeverity.Error, 'asmdef-read');
    }
  }
  for (const file of [...walkAsmrefs(path.join(root, 'Assets')), ...walkAsmrefs(path.join(root, 'Packages'))]) {
    try {
      issues.push(...validateAsmref(file, readText(file), index));
    } catch {
      addIssue(issues, file, 0, 1, 'Unable to read assembly reference', DiagnosticSeverity.Error, 'asmref-read');
    }
  }
  return issues;
}

function walkAsmrefs(base: string): string[] {
  if (!existsSync(base)) return [];
  try {
    const entries = readdirSync(base, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.asmref'))
      .map((entry) => {
        const parent = (entry as unknown as { parentPath?: string }).parentPath ?? (entry as unknown as { path?: string }).path;
        return parent ? path.join(parent, entry.name) : undefined;
      })
      .filter((file): file is string => file !== undefined && !isIgnoredPath(file, base));
  } catch {
    return [];
  }
}

function findStringNode(node: Node | undefined, offset: number): Node | undefined {
  if (!node) return undefined;
  if (node.type === 'string' && node.offset <= offset && offset <= node.offset + node.length) return node;
  for (const child of node.children ?? []) {
    const found = findStringNode(child, offset);
    if (found) return found;
  }
  return undefined;
}

export function referenceAt(file: string, text: string, offset: number, index: AsmdefIndex): AsmdefInfo | undefined {
  const tree = parseTree(text, [], JSON_OPTIONS);
  const node = findStringNode(tree, offset);
  if (!node) return undefined;
  const value = String(node.value);
  if (isAsmdefFile(file)) {
    const json = safeJson(text);
    if (!json || !Array.isArray(json.references) || !(json.references as unknown[]).includes(value)) return undefined;
  } else if (isAsmrefFile(file)) {
    const json = safeJson(text);
    if (!json || json.reference !== value) return undefined;
  } else {
    return undefined;
  }
  return resolveReference(value, index);
}

export function asmdefInfoAt(file: string, text: string, index: AsmdefIndex): AsmdefInfo | undefined {
  const json = safeJson(text);
  if (!json || typeof json.name !== 'string') return undefined;
  return index.byName.get(json.name)?.find((item) => path.resolve(item.path) === path.resolve(file));
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

