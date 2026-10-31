import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMap, isSeq } from 'yaml';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { isIgnoredPath, readMetaGuid, readText } from './project.js';
import { collectYamlErrors, mapGuid, parseUnityYaml, rawScalar, spanOf, stringValue, type Span } from './unity-yaml.js';
import { addIssue } from './types.js';

interface SharedTable {
  file: string;
  ids: Map<string, Span | undefined>;
  keys: Map<string, { key: string; span?: Span }>;
}

function findSharedTables(root: string): string[] {
  const base = path.join(root, 'Assets');
  if (!existsSync(base)) return [];
  let entries;
  try {
    entries = readdirSync(base, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(' Shared Data.asset')) continue;
    const parent = (entry as unknown as { parentPath?: string }).parentPath ?? (entry as unknown as { path?: string }).path;
    if (!parent) continue;
    const file = path.join(parent, entry.name);
    if (isIgnoredPath(file, base)) continue;
    result.push(file);
  }
  return result;
}

const PLACEHOLDER = /\{(\d+|[A-Za-z_][A-Za-z0-9_.]*)\}/g;

function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(PLACEHOLDER)].map((match) => match[1]));
}

export function validateLocalization(root: string, guidIndex?: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  const sharedFiles = findSharedTables(root);
  if (sharedFiles.length === 0) return issues;

  const byGuid = new Map<string, SharedTable>();
  const placeholderSets = new Map<string, Map<string, { file: string; span?: Span; values: Set<string> }>>();
  for (const file of sharedFiles) {
    const text = readText(file);
    const doc = parseUnityYaml(text);
    const rootNode = doc.get('MonoBehaviour');
    const local: Issue[] = [];
    collectYamlErrors(local, file, doc, 'localization-yaml');
    issues.push(...local);
    if (!isMap(rootNode)) continue;
    const collectionName = stringValue(rootNode.get('m_TableCollectionName', true));
    if (collectionName === undefined || collectionName.length === 0) {
      addIssue(issues, file, 0, 1, 'Table collection name is missing', DiagnosticSeverity.Warning, 'localization-collection-name');
    }
    const collectionGuid = rawScalar(text, rootNode.get('m_TableCollectionNameGuidString', true))?.toLowerCase();
    const sharedMetaGuid = readMetaGuid(`${file}.meta`)?.toLowerCase();
    if (collectionGuid && sharedMetaGuid && collectionGuid !== sharedMetaGuid) {
      addIssue(
        issues,
        file,
        0,
        1,
        `m_TableCollectionNameGuidString ${collectionGuid} does not match the asset GUID ${sharedMetaGuid}`,
        DiagnosticSeverity.Warning,
        'localization-collection-guid'
      );
    }
    const table: SharedTable = { file, ids: new Map(), keys: new Map() };
    const entries = rootNode.get('m_Entries');
    if (isSeq(entries)) {
      for (const item of entries.items) {
        if (!isMap(item)) continue;
        const idNode = item.get('m_Id', true);
        const id = rawScalar(text, idNode);
        if (id) {
          if (table.ids.has(id)) {
            const span = spanOf(idNode);
            addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Shared entry id ${id} is duplicated`, DiagnosticSeverity.Warning, 'localization-shared-id-duplicate');
          }
          table.ids.set(id, spanOf(idNode));
        }
        const keyNode = item.get('m_Key', true);
        const key = stringValue(keyNode);
        if (key === undefined || key.length === 0) {
          const span = spanOf(item);
          addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, 'Shared entry has an empty key', DiagnosticSeverity.Warning, 'localization-key-empty');
        } else if (table.keys.has(key)) {
          const span = spanOf(keyNode);
          addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Key "${key}" is duplicated`, DiagnosticSeverity.Error, 'localization-key-duplicate');
        } else {
          table.keys.set(key, { key, span: spanOf(keyNode) });
        }
      }
    }
    if (sharedMetaGuid) byGuid.set(sharedMetaGuid, table);
  }

  const directories = [...new Set(sharedFiles.map((file) => path.dirname(file)))];
  const tableFiles: string[] = [];
  for (const dir of directories) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.asset') && !entry.name.endsWith(' Shared Data.asset')) {
          tableFiles.push(path.join(dir, entry.name));
        }
      }
    } catch {
      continue;
    }
  }

  for (const file of tableFiles) {
    const text = readText(file);
    const doc = parseUnityYaml(text);
    const local: Issue[] = [];
    collectYamlErrors(local, file, doc, 'localization-yaml');
    issues.push(...local);
    const rootNode = doc.get('MonoBehaviour');
    if (!isMap(rootNode)) continue;
    const sharedGuid = mapGuid(rootNode.get('m_SharedData', true), text);
    if (!sharedGuid) continue;
    const shared = byGuid.get(sharedGuid);
    if (!shared) {
      addIssue(issues, file, 0, 1, `Shared table data GUID ${sharedGuid} was not found`, DiagnosticSeverity.Warning, 'localization-shared-missing');
      continue;
    }
    const locale = stringValue(rootNode.getIn(['m_LocaleId', 'm_Code'], true));
    if (!locale) {
      addIssue(issues, file, 0, 1, 'Table locale code is missing', DiagnosticSeverity.Warning, 'localization-locale-missing');
    }
    const tableData = rootNode.get('m_TableData');
    if (!isSeq(tableData)) continue;
    const present = new Set<string>();
    for (const item of tableData.items) {
      if (!isMap(item)) continue;
      const idNode = item.get('m_Id', true);
      const id = rawScalar(text, idNode);
      if (!id) continue;
      const span = spanOf(idNode);
      if (present.has(id)) {
        addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Entry id ${id} is duplicated`, DiagnosticSeverity.Error, 'localization-id-duplicate');
      }
      present.add(id);
      if (!shared.ids.has(id)) {
        addIssue(
          issues,
          file,
          span?.start ?? 0,
          span?.end ?? 1,
          `Entry id ${id} does not exist in ${path.basename(shared.file)}`,
          DiagnosticSeverity.Warning,
          'localization-orphan-entry'
        );
      }
      const localizedNode = item.get('m_Localized', true);
      const localizedGuid = mapGuid(localizedNode, text);
      if (localizedGuid && guidIndex && !guidIndex.has(localizedGuid)) {
        addIssue(
          issues,
          file,
          span?.start ?? 0,
          span?.end ?? 1,
          `Localized asset GUID ${localizedGuid} was not found`,
          DiagnosticSeverity.Warning,
          'localization-asset-missing'
        );
      }
      const localized = stringValue(localizedNode);
      if (localized && locale) {
        const key = `${sharedGuid}\u0000${id}`;
        const byLocale = placeholderSets.get(key) ?? new Map();
        byLocale.set(locale, { file, span, values: placeholders(localized) });
        placeholderSets.set(key, byLocale);
      }
    }
    for (const [id, span] of shared.ids) {
      if (present.has(id)) continue;
      addIssue(
        issues,
        shared.file,
        span?.start ?? 0,
        span?.end ?? 1,
        `No ${locale ?? 'locale'} translation in ${path.basename(file)}`,
        DiagnosticSeverity.Warning,
        'localization-missing-entry'
      );
    }
  }

  for (const [key, byLocale] of placeholderSets) {
    const locales = [...byLocale.keys()].sort();
    if (locales.length < 2) continue;
    const baseline = byLocale.get(locales[0])!;
    const baselineSignature = [...baseline.values].sort().join(',');
    for (const locale of locales.slice(1)) {
      const entry = byLocale.get(locale)!;
      const signature = [...entry.values].sort().join(',');
      if (signature === baselineSignature) continue;
      const id = key.split('\u0000')[1];
      addIssue(
        issues,
        entry.file,
        entry.span?.start ?? 0,
        entry.span?.end ?? 1,
        `Placeholders for entry id ${id} differ from ${locales[0]}: {${baselineSignature}} vs {${signature}}`,
        DiagnosticSeverity.Warning,
        'localization-placeholder-mismatch'
      );
    }
  }
  return issues;
}
