import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { readText } from './project.js';
import { collectFiles, type ScanOptions } from './scan.js';
import { addIssue } from './types.js';

const BUILTIN_SCHEMES = new Set(['Keyboard&Mouse', 'Gamepad', 'Touch', 'Joystick', 'XR', 'Mouse', 'Keyboard', 'Pen']);

interface ActionMap {
  name?: string;
  actions?: { name?: string; id?: string }[];
  bindings?: {
    action?: string;
    path?: string;
    id?: string;
    groups?: string;
    isComposite?: boolean;
    isPartOfComposite?: boolean;
  }[];
}

interface InputActionsAsset {
  version?: number;
  name?: string;
  maps?: ActionMap[];
  controlSchemes?: { name?: string; bindingGroup?: string }[];
}

function actionFiles(root: string, options: ScanOptions = {}): string[] {
  return collectFiles(root, ['.inputactions'], options);
}

export function validateInputActionsFile(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  let asset: InputActionsAsset;
  try {
    asset = JSON.parse(text.replace(/^\uFEFF/, '')) as InputActionsAsset;
  } catch (error) {
    addIssue(issues, file, 0, 1, `JSON: ${(error as Error).message}`, DiagnosticSeverity.Error, 'inputactions-json');
    return issues;
  }
  if (asset.version !== undefined && asset.version !== 1) {
    addIssue(issues, file, 0, 1, `Unexpected input actions version ${String(asset.version)}`, DiagnosticSeverity.Warning, 'inputactions-version');
  }

  const ids = new Map<string, string>();
  const rememberId = (id: string | undefined, label: string): void => {
    if (!id) return;
    if (ids.has(id)) {
      addIssue(issues, file, 0, 1, `Duplicate id ${id} (${label} and ${ids.get(id)})`, DiagnosticSeverity.Warning, 'inputactions-id-duplicate');
      return;
    }
    ids.set(id, label);
  };

  const schemes = Array.isArray(asset.controlSchemes) ? asset.controlSchemes : [];
  const schemeNames = new Set<string>();
  for (const scheme of schemes) {
    const name = scheme.name ?? '';
    if (name.length === 0) continue;
    if (schemeNames.has(name)) {
      addIssue(issues, file, 0, 1, `Control scheme "${name}" is duplicated`, DiagnosticSeverity.Warning, 'inputactions-scheme-duplicate');
    }
    schemeNames.add(name);
  }

  const maps = Array.isArray(asset.maps) ? asset.maps : [];
  const mapNames = new Set<string>();
  for (const map of maps) {
    const mapName = map.name ?? '';
    if (mapName.length === 0) {
      addIssue(issues, file, 0, 1, 'Action map has no name', DiagnosticSeverity.Warning, 'inputactions-map-name');
    } else if (mapNames.has(mapName)) {
      addIssue(issues, file, 0, 1, `Action map "${mapName}" is duplicated`, DiagnosticSeverity.Error, 'inputactions-map-duplicate');
    }
    mapNames.add(mapName);

    const actions = Array.isArray(map.actions) ? map.actions : [];
    const actionNames = new Set<string>();
    for (const action of actions) {
      const name = action.name ?? '';
      rememberId(action.id, `action ${mapName}/${name}`);
      if (name.length === 0) {
        addIssue(issues, file, 0, 1, `Action in map "${mapName}" has no name`, DiagnosticSeverity.Warning, 'inputactions-action-name');
        continue;
      }
      if (actionNames.has(name)) {
        addIssue(issues, file, 0, 1, `Action "${name}" is duplicated in map "${mapName}"`, DiagnosticSeverity.Error, 'inputactions-action-duplicate');
      }
      actionNames.add(name);
    }

    const bindings = Array.isArray(map.bindings) ? map.bindings : [];
    let compositeAction: string | undefined;
    for (const binding of bindings) {
      rememberId(binding.id, `binding in ${mapName}`);
      if (binding.action && !actionNames.has(binding.action)) {
        addIssue(issues, file, 0, 1, `Binding references missing action "${binding.action}" in map "${mapName}"`, DiagnosticSeverity.Error, 'inputactions-binding-action');
      }
      if (binding.isComposite) {
        compositeAction = binding.action;
      } else if (binding.isPartOfComposite) {
        if (!compositeAction || compositeAction !== binding.action) {
          addIssue(
            issues,
            file,
            0,
            1,
            `Composite part for "${binding.action ?? '?'}" in map "${mapName}" has no preceding composite`,
            DiagnosticSeverity.Warning,
            'inputactions-composite-part'
          );
        }
      } else {
        compositeAction = undefined;
      }
      if (!binding.path && !binding.isComposite && !binding.isPartOfComposite) {
        addIssue(issues, file, 0, 1, `Binding for "${binding.action ?? 'composite'}" in map "${mapName}" has no path`, DiagnosticSeverity.Warning, 'inputactions-binding-path');
      }
      if (binding.path && !binding.isComposite && !binding.isPartOfComposite && !/^(\*|<[^<>]+>)\//.test(binding.path)) {
        addIssue(
          issues,
          file,
          0,
          1,
          `Binding path "${binding.path}" in map "${mapName}" is not a control path`,
          DiagnosticSeverity.Warning,
          'inputactions-binding-path-syntax'
        );
      }
      if (binding.groups) {
        for (const group of binding.groups.split(/[;,]/).map((item) => item.trim()).filter(Boolean)) {
          if (!schemeNames.has(group) && !BUILTIN_SCHEMES.has(group)) {
            addIssue(
              issues,
              file,
              0,
              1,
              `Binding group "${group}" in map "${mapName}" is not a control scheme`,
              DiagnosticSeverity.Warning,
              'inputactions-binding-group'
            );
          }
        }
      }
    }
  }

  return issues;
}

export function validateInputActions(root: string, options: ScanOptions = {}): Issue[] {
  const issues: Issue[] = [];
  for (const file of actionFiles(root, options)) {
    try {
      issues.push(...validateInputActionsFile(file, readText(file)));
    } catch (error) {
      addIssue(issues, file, 0, 1, `Unable to read input actions: ${(error as Error).message}`, DiagnosticSeverity.Warning, 'inputactions-read');
    }
  }
  return issues;
}
