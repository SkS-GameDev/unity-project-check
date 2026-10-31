import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMap, isSeq } from 'yaml';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { addIssue } from './types.js';
import { isIgnoredPath, readMetaGuid, readText } from './project.js';
import {
  collectYamlErrors,
  mapGuid,
  parseUnityYaml,
  spanOf,
  stringValue,
  stringsOf,
  type Span,
} from './unity-yaml.js';
import { validateInputManager, validatePhysicsSettings, validatePlayerSettings, validateQualitySettings } from './settings-extra.js';

const EMPTY_GUID = '00000000000000000000000000000000';

export function validateProjectVersion(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  const doc = parseUnityYaml(text);
  collectYamlErrors(issues, file, doc, 'settings-yaml');
  const versionNode = doc.get('m_EditorVersion', true);
  const version = stringValue(versionNode);
  const span = spanOf(versionNode);
  if (!version) {
    addIssue(issues, file, 0, 1, 'm_EditorVersion is missing', DiagnosticSeverity.Error, 'settings-version');
  } else if (!/^\d+\.\d+\.\d+[abfp]\d+$/.test(version)) {
    addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Unexpected editor version "${version}"`, DiagnosticSeverity.Warning, 'settings-version');
  }
  return issues;
}

let guidCache: { root: string; at: number; index: Map<string, string> } | undefined;
const GUID_TTL_MS = 30000;

export function buildGuidIndex(root: string): Map<string, string> {
  if (guidCache && guidCache.root === root && Date.now() - guidCache.at < GUID_TTL_MS) return guidCache.index;
  const index = new Map<string, string>();
  for (const base of [path.join(root, 'Assets'), path.join(root, 'Packages'), path.join(root, 'Library', 'PackageCache')]) {
    if (!existsSync(base)) continue;
    let entries;
    try {
      entries = readdirSync(base, { recursive: true, withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.meta')) continue;
      const parent = (entry as unknown as { parentPath?: string }).parentPath ?? (entry as unknown as { path?: string }).path;
      if (!parent) continue;
      const metaPath = path.join(parent, entry.name);
      if (isIgnoredPath(metaPath, base)) continue;
      const guid = readMetaGuid(metaPath);
      if (guid) index.set(guid.toLowerCase(), metaPath.slice(0, -'.meta'.length));
    }
  }
  guidCache = { root, at: Date.now(), index };
  return index;
}

function checkScenes(file: string, root: string, doc: ReturnType<typeof parseUnityYaml>, issues: Issue[]): void {
  const scenes = doc.getIn(['EditorBuildSettings', 'm_Scenes']);
  if (!isSeq(scenes)) return;
  const seen = new Set<string>();
  for (const item of scenes.items) {
    if (!isMap(item)) continue;
    const pathNode = item.get('path', true);
    const scenePath = stringValue(pathNode);
    if (!scenePath) continue;
    const span = spanOf(pathNode);
    if (seen.has(scenePath)) {
      addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Scene "${scenePath}" is listed twice`, DiagnosticSeverity.Warning, 'settings-scene-duplicate');
    }
    seen.add(scenePath);
    if (!existsSync(path.join(root, scenePath))) {
      addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Scene "${scenePath}" does not exist`, DiagnosticSeverity.Error, 'settings-scene-missing');
    }
  }
}

function checkDuplicates(
  issues: Issue[],
  file: string,
  entries: { value: string; span?: Span }[],
  label: string,
  code: string,
  severity: DiagnosticSeverity
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.value.length === 0) continue;
    if (seen.has(entry.value)) {
      addIssue(issues, file, entry.span?.start ?? 0, entry.span?.end ?? 1, `${label} "${entry.value}" is duplicated`, severity, code);
    }
    seen.add(entry.value);
  }
}

export function validateTagManager(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  const doc = parseUnityYaml(text);
  collectYamlErrors(issues, file, doc, 'settings-yaml');
  checkDuplicates(issues, file, stringsOf(doc.getIn(['TagManager', 'tags'])), 'Tag', 'settings-tag-duplicate', DiagnosticSeverity.Error);
  const layers = stringsOf(doc.getIn(['TagManager', 'layers']));
  if (layers.length !== 32) {
    addIssue(issues, file, 0, 1, `TagManager layers has ${layers.length} entries, Unity expects 32`, DiagnosticSeverity.Warning, 'settings-layers-length');
  }
  checkDuplicates(issues, file, layers, 'Layer', 'settings-layer-duplicate', DiagnosticSeverity.Warning);
  const sorting = doc.getIn(['TagManager', 'm_SortingLayers']);
  if (isSeq(sorting)) {
    checkDuplicates(
      issues,
      file,
      sorting.items.filter(isMap).map((item) => ({ value: stringValue(item.get('name', true)) ?? '', span: spanOf(item.get('name', true)) })),
      'Sorting layer',
      'settings-sorting-layer-duplicate',
      DiagnosticSeverity.Warning
    );
  }
  return issues;
}

function checkGuidRef(
  issues: Issue[],
  file: string,
  text: string,
  node: unknown,
  guidIndex: Map<string, string>,
  label: string,
  code: string
): void {
  const guid = mapGuid(node, text);
  if (!guid || guid === EMPTY_GUID) return;
  if (!guidIndex.has(guid)) {
    const span = spanOf(node);
    addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `${label} GUID ${guid} was not found in Assets or Packages`, DiagnosticSeverity.Warning, code);
  }
}

export function validateGraphicsSettings(file: string, text: string, guidIndex: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  const doc = parseUnityYaml(text);
  collectYamlErrors(issues, file, doc, 'settings-yaml');
  checkGuidRef(
    issues,
    file,
    text,
    doc.getIn(['GraphicsSettings', 'm_CustomRenderPipeline'], true),
    guidIndex,
    'Render pipeline asset',
    'settings-render-pipeline'
  );
  return issues;
}

export function validateSchemaVersion(root: string): Issue[] {
  const schemaPath = path.join(root, 'Library', 'UnityYaml', 'schema.json');
  const versionPath = path.join(root, 'ProjectSettings', 'ProjectVersion.txt');
  if (!existsSync(schemaPath) || !existsSync(versionPath)) return [];
  try {
    const schema = JSON.parse(readText(schemaPath)) as { unityVersion?: unknown };
    const version = /^m_EditorVersion:\s*(\S+)/m.exec(readText(versionPath))?.[1];
    if (typeof schema.unityVersion !== 'string' || !version || schema.unityVersion === version) return [];
    return [
      {
        file: versionPath,
        start: 0,
        end: 1,
        severity: DiagnosticSeverity.Warning,
        message: `UnityYaml schema was generated for ${schema.unityVersion}, project is ${version}`,
        code: 'schema-version',
      },
    ];
  } catch {
    return [];
  }
}

const SETTINGS_FILES = [
  'TagManager.asset',
  'GraphicsSettings.asset',
  'EditorBuildSettings.asset',
  'ProjectSettings.asset',
  'QualitySettings.asset',
  'InputManager.asset',
  'DynamicsManager.asset',
  'Physics2DSettings.asset',
];

export function validateSettingsProject(root: string, guidIndex = buildGuidIndex(root)): Issue[] {
  const issues: Issue[] = [];
  const dir = path.join(root, 'ProjectSettings');
  const versionFile = path.join(dir, 'ProjectVersion.txt');
  if (existsSync(versionFile)) issues.push(...validateProjectVersion(versionFile, readText(versionFile)));
  for (const name of SETTINGS_FILES) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    const text = readText(file);
    if (name === 'TagManager.asset') issues.push(...validateTagManager(file, text));
    else if (name === 'GraphicsSettings.asset') issues.push(...validateGraphicsSettings(file, text, guidIndex));
    else if (name === 'ProjectSettings.asset') issues.push(...validatePlayerSettings(file, text));
    else if (name === 'QualitySettings.asset') issues.push(...validateQualitySettings(file, text));
    else if (name === 'InputManager.asset') issues.push(...validateInputManager(file, text));
    else if (name === 'DynamicsManager.asset' || name === 'Physics2DSettings.asset') issues.push(...validatePhysicsSettings(file, text));
    else {
      const doc = parseUnityYaml(text);
      const local: Issue[] = [];
      collectYamlErrors(local, file, doc, 'settings-yaml');
      checkScenes(file, root, doc, local);
      issues.push(...local);
    }
  }
  issues.push(...validateSchemaVersion(root));
  return issues;
}
