import { isMap, isScalar, isSeq } from 'yaml';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { collectYamlErrors, parseUnityYaml, spanOf, stringValue } from './unity-yaml.js';
import { addIssue } from './types.js';

function numberValue(node: unknown): number | undefined {
  return isScalar(node) && typeof node.value === 'number' ? node.value : undefined;
}

function entries(node: unknown): unknown[] {
  return isSeq(node) ? node.items : [];
}

export function validatePlayerSettings(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  const doc = parseUnityYaml(text);
  collectYamlErrors(issues, file, doc, 'settings-yaml');
  const root = doc.get('PlayerSettings');
  if (!isMap(root)) return issues;

  const product = root.get('productName', true);
  if (!stringValue(product)) {
    const span = spanOf(product);
    addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, 'productName is empty', DiagnosticSeverity.Warning, 'settings-product-name');
  }
  const company = root.get('companyName', true);
  if (!stringValue(company)) {
    const span = spanOf(company);
    addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, 'companyName is empty', DiagnosticSeverity.Warning, 'settings-company-name');
  }
  const versionNode = root.get('bundleVersion', true);
  const version = stringValue(versionNode);
  if (version !== undefined && !/^\d+(\.\d+)*$/.test(version)) {
    const span = spanOf(versionNode);
    addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `bundleVersion "${version}" is not numeric`, DiagnosticSeverity.Warning, 'settings-bundle-version');
  }
  const inputNode = root.get('activeInputHandler', true);
  const inputHandler = numberValue(inputNode);
  if (inputHandler !== undefined && ![0, 1, 2].includes(inputHandler)) {
    const span = spanOf(inputNode);
    addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `activeInputHandler ${inputHandler} is not 0, 1 or 2`, DiagnosticSeverity.Warning, 'settings-input-handler');
  }
  const backends = root.get('scriptingBackend');
  if (isMap(backends)) {
    for (const pair of backends.items) {
      const value = numberValue(pair.value);
      if (value !== undefined && ![0, 1, 2].includes(value)) {
        const span = spanOf(pair.value);
        addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `scriptingBackend ${String((pair.key as { value?: unknown } | undefined)?.value)} is ${value}`, DiagnosticSeverity.Warning, 'settings-scripting-backend');
      }
    }
  }
  return issues;
}

export function validateQualitySettings(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  const doc = parseUnityYaml(text);
  collectYamlErrors(issues, file, doc, 'settings-yaml');
  const root = doc.get('QualitySettings');
  if (!isMap(root)) return issues;

  const levels = entries(root.get('m_QualitySettings'));
  if (levels.length === 0) {
    addIssue(issues, file, 0, 1, 'No quality levels are defined', DiagnosticSeverity.Error, 'settings-quality-empty');
    return issues;
  }
  const names = new Set<string>();
  for (const level of levels) {
    if (!isMap(level)) continue;
    const nameNode = level.get('name', true);
    const name = stringValue(nameNode);
    if (!name) {
      const span = spanOf(level);
      addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, 'Quality level has no name', DiagnosticSeverity.Warning, 'settings-quality-name');
      continue;
    }
    if (names.has(name)) {
      const span = spanOf(nameNode);
      addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Quality level "${name}" is duplicated`, DiagnosticSeverity.Warning, 'settings-quality-duplicate');
    }
    names.add(name);
  }
  const currentNode = root.get('m_CurrentQuality', true);
  const current = numberValue(currentNode);
  if (current !== undefined && (current < 0 || current >= levels.length)) {
    const span = spanOf(currentNode);
    addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `m_CurrentQuality ${current} is outside 0..${levels.length - 1}`, DiagnosticSeverity.Warning, 'settings-quality-index');
  }
  return issues;
}

export function validateInputManager(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  const doc = parseUnityYaml(text);
  collectYamlErrors(issues, file, doc, 'settings-yaml');
  const root = doc.get('InputManager');
  if (!isMap(root)) return issues;

  const names = new Set<string>();
  for (const axis of entries(root.get('m_Axes'))) {
    if (!isMap(axis)) continue;
    const nameNode = axis.get('m_Name', true);
    const name = stringValue(nameNode);
    const span = spanOf(axis);
    if (!name) {
      addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, 'Input axis has no name', DiagnosticSeverity.Warning, 'settings-axis-name');
      continue;
    }
    if (names.has(name)) {
      const nameSpan = spanOf(nameNode);
      addIssue(issues, file, nameSpan?.start ?? 0, nameSpan?.end ?? 1, `Input axis "${name}" is duplicated`, DiagnosticSeverity.Warning, 'settings-axis-duplicate');
    }
    names.add(name);
    const buttons = ['positiveButton', 'negativeButton', 'altPositiveButton'].map((key) => stringValue(axis.get(key, true)) ?? '');
    const typeNode = axis.get('type', true);
    const type = numberValue(typeNode);
    if (type === 0 && buttons.every((button) => button.length === 0)) {
      addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Input axis "${name}" has no buttons`, DiagnosticSeverity.Warning, 'settings-axis-buttons');
    }
    if (type !== undefined && ![0, 1, 2].includes(type)) {
      const typeSpan = spanOf(typeNode);
      addIssue(issues, file, typeSpan?.start ?? 0, typeSpan?.end ?? 1, `Input axis "${name}" has type ${type}`, DiagnosticSeverity.Warning, 'settings-axis-type');
    }
  }
  return issues;
}

export function validatePhysicsSettings(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  const doc = parseUnityYaml(text);
  collectYamlErrors(issues, file, doc, 'settings-yaml');
  const root = doc.get('PhysicsManager') ?? doc.get('Physics2DSettings');
  if (!isMap(root)) return issues;
  const matrixNode = root.get('m_LayerCollisionMatrix', true);
  const matrix = stringValue(matrixNode);
  if (matrix !== undefined && !/^[0-9a-fA-F]{256}$/.test(matrix)) {
    const span = spanOf(matrixNode);
    addIssue(
      issues,
      file,
      span?.start ?? 0,
      span?.end ?? 1,
      `m_LayerCollisionMatrix has ${matrix.length} hex characters, expected 256`,
      DiagnosticSeverity.Warning,
      'settings-collision-matrix'
    );
  }
  return issues;
}
