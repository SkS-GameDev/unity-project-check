import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Node } from 'jsonc-parser';
import { findNodeAtLocation, parse, parseTree, printParseErrorCode } from 'jsonc-parser';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { addIssue } from './types.js';
import { isLockFile, isManifestFile, readText } from './project.js';

const JSON_OPTIONS = { allowTrailingComma: true, disallowComments: false };
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

interface ObjectEntry {
  key: Node;
  value: Node;
}

function entries(node: Node | undefined): ObjectEntry[] {
  if (!node || node.type !== 'object') return [];
  const result: ObjectEntry[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== 'property' || !child.children || child.children.length < 2) continue;
    result.push({ key: child.children[0], value: child.children[1] });
  }
  return result;
}

function stringValue(node: Node | undefined): string | undefined {
  return node && node.type === 'string' ? String(node.value) : undefined;
}

function parseFile(file: string, text: string, issues: Issue[]): Node | undefined {
  text = text.replace(/^\uFEFF/, '');
  const errors: { offset: number; length: number; error: number }[] = [];
  parse(text, errors, JSON_OPTIONS);
  for (const error of errors) {
    addIssue(issues, file, error.offset, error.offset + error.length, `JSON: ${printParseErrorCode(error.error)}`, DiagnosticSeverity.Error, 'manifest-json');
  }
  return parseTree(text, errors, JSON_OPTIONS);
}

function validateVersion(root: string, file: string, node: Node, version: string, issues: Issue[]): void {
  const start = node.offset;
  const end = node.offset + node.length;
  if (version.startsWith('file:')) {
    const relative = version.slice('file:'.length);
    const candidates = [path.resolve(root, relative), path.resolve(root, 'Packages', relative)];
    if (!candidates.some((candidate) => existsSync(candidate))) {
      addIssue(issues, file, start, end, `Local package path "${relative}" was not found`, DiagnosticSeverity.Warning, 'manifest-local-package');
    }
    return;
  }
  if (/^(https?|git\+https?|ssh|git@)/.test(version)) {
    return;
  }
  if (!SEMVER.test(version)) {
    addIssue(issues, file, start, end, `Unexpected package version "${version}"`, DiagnosticSeverity.Warning, 'manifest-version');
  }
}

function lockDependencies(root: string): Map<string, string | undefined> | undefined {
  const lockPath = path.join(root, 'Packages', 'packages-lock.json');
  if (!existsSync(lockPath)) return undefined;
  try {
    const json = JSON.parse(readText(lockPath)) as { dependencies?: Record<string, { version?: string }> };
    const result = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(json.dependencies ?? {})) {
      result.set(name, typeof value?.version === 'string' ? value.version : undefined);
    }
    return result;
  } catch {
    return undefined;
  }
}

export function validateManifest(file: string, text: string, root: string): Issue[] {
  const issues: Issue[] = [];
  const tree = parseFile(file, text, issues);
  if (!tree) return issues;

  if (isManifestFile(file)) {
    const dependencies = findNodeAtLocation(tree, ['dependencies']);
    if (dependencies && dependencies.type !== 'object') {
      addIssue(issues, file, dependencies.offset, dependencies.offset + dependencies.length, 'dependencies must be an object', DiagnosticSeverity.Error, 'manifest-type');
    } else {
      const lock = lockDependencies(root);
      for (const entry of entries(dependencies)) {
        const name = stringValue(entry.key);
        const version = stringValue(entry.value);
        if (!name) {
          addIssue(issues, file, entry.key.offset, entry.key.offset + entry.key.length, 'Dependency name must be a string', DiagnosticSeverity.Error, 'manifest-type');
          continue;
        }
        if (!version) {
          addIssue(issues, file, entry.value.offset, entry.value.offset + entry.value.length, `Dependency "${name}" must have a string version`, DiagnosticSeverity.Error, 'manifest-type');
          continue;
        }
        validateVersion(root, file, entry.value, version, issues);
        if (lock && !lock.has(name)) {
          addIssue(issues, file, entry.value.offset, entry.value.offset + entry.value.length, `Dependency "${name}" is missing from packages-lock.json`, DiagnosticSeverity.Warning, 'manifest-lock-missing');
        } else if (lock) {
          const locked = lock.get(name);
          if (locked && SEMVER.test(version) && SEMVER.test(locked) && locked !== version) {
            addIssue(issues, file, entry.value.offset, entry.value.offset + entry.value.length, `Dependency "${name}" is ${version} in manifest but ${locked} in packages-lock.json`, DiagnosticSeverity.Warning, 'manifest-lock-version');
          }
        }
      }
    }

    const registries = findNodeAtLocation(tree, ['scopedRegistries']);
    if (registries) {
      if (registries.type !== 'array') {
        addIssue(issues, file, registries.offset, registries.offset + registries.length, 'scopedRegistries must be an array', DiagnosticSeverity.Error, 'manifest-type');
      } else {
        for (const registry of registries.children ?? []) {
          if (registry.type !== 'object') {
            addIssue(issues, file, registry.offset, registry.offset + registry.length, 'scopedRegistries entries must be objects', DiagnosticSeverity.Error, 'manifest-type');
            continue;
          }
          const name = findNodeAtLocation(registry, ['name']);
          const url = findNodeAtLocation(registry, ['url']);
          const scopes = findNodeAtLocation(registry, ['scopes']);
          if (!stringValue(name)) addIssue(issues, file, (name ?? registry).offset, (name ?? registry).offset + (name ?? registry).length, 'Registry name is required', DiagnosticSeverity.Error, 'manifest-registry');
          if (!stringValue(url)) addIssue(issues, file, (url ?? registry).offset, (url ?? registry).offset + (url ?? registry).length, 'Registry url is required', DiagnosticSeverity.Error, 'manifest-registry');
          if (scopes && scopes.type !== 'array') addIssue(issues, file, scopes.offset, scopes.offset + scopes.length, 'Registry scopes must be an array', DiagnosticSeverity.Error, 'manifest-type');
        }
      }
    }

    const testables = findNodeAtLocation(tree, ['testables']);
    if (testables && testables.type !== 'array') {
      addIssue(issues, file, testables.offset, testables.offset + testables.length, 'testables must be an array', DiagnosticSeverity.Error, 'manifest-type');
    }

    const enableLockFile = findNodeAtLocation(tree, ['enableLockFile']);
    if (enableLockFile && enableLockFile.type !== 'boolean') {
      addIssue(issues, file, enableLockFile.offset, enableLockFile.offset + enableLockFile.length, 'enableLockFile must be a boolean', DiagnosticSeverity.Error, 'manifest-type');
    }
    const resolutionStrategy = findNodeAtLocation(tree, ['resolutionStrategy']);
    if (resolutionStrategy && resolutionStrategy.type !== 'string') {
      addIssue(issues, file, resolutionStrategy.offset, resolutionStrategy.offset + resolutionStrategy.length, 'resolutionStrategy must be a string', DiagnosticSeverity.Error, 'manifest-type');
    }
  }

  if (isLockFile(file)) {
    const dependencies = findNodeAtLocation(tree, ['dependencies']);
    if (dependencies && dependencies.type !== 'object') {
      addIssue(issues, file, dependencies.offset, dependencies.offset + dependencies.length, 'dependencies must be an object', DiagnosticSeverity.Error, 'manifest-type');
    } else {
      for (const entry of entries(dependencies)) {
        const name = stringValue(entry.key);
        if (!name) continue;
        if (entry.value.type !== 'object') {
          addIssue(issues, file, entry.value.offset, entry.value.offset + entry.value.length, `Lock entry "${name}" must be an object`, DiagnosticSeverity.Error, 'manifest-type');
          continue;
        }
        const version = findNodeAtLocation(entry.value, ['version']);
        const source = findNodeAtLocation(entry.value, ['source']);
        if (version && version.type !== 'string') addIssue(issues, file, version.offset, version.offset + version.length, `Lock version for "${name}" must be a string`, DiagnosticSeverity.Error, 'manifest-type');
        if (source && source.type !== 'string') addIssue(issues, file, source.offset, source.offset + source.length, `Lock source for "${name}" must be a string`, DiagnosticSeverity.Error, 'manifest-type');
      }
    }
  }

  return issues;
}

export function validateManifestProject(root: string): Issue[] {
  const issues: Issue[] = [];
  for (const name of ['manifest.json', 'packages-lock.json']) {
    const file = path.join(root, 'Packages', name);
    if (!existsSync(file)) continue;
    try {
      issues.push(...validateManifest(file, readText(file), root));
    } catch {
      addIssue(issues, file, 0, 1, `Unable to read ${name}`, DiagnosticSeverity.Error, 'manifest-read');
    }
  }
  return issues;
}
