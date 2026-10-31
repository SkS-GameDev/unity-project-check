import { isMap, isSeq } from 'yaml';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { readText } from './project.js';
import { collectFiles, type ScanOptions } from './scan.js';
import { parseUnityYamlAll, rawScalar, spanOf, stringValue } from './unity-yaml.js';
import { addIssue } from './types.js';

const HEADER = /^--- !u!(\d+) &(-?\d+)(?: stripped)?/gm;

const CONTROLLER = '91';
const STATE_MACHINE = '1107';
const STATE = '1102';
const TRANSITION = '1101';
const TRANSITION_ENTRY = '1109';

interface DocumentInfo {
  classId: string;
  fileId: string;
  document: ReturnType<typeof parseUnityYamlAll>[number];
}

function fileIdOf(node: unknown, text: string): string | undefined {
  if (!isMap(node)) return undefined;
  return rawScalar(text, node.get('fileID', true));
}

function guidOf(node: unknown, text: string): string | undefined {
  if (!isMap(node)) return undefined;
  return rawScalar(text, node.get('guid', true));
}

function refList(node: unknown, key: string): unknown[] {
  if (!isMap(node)) return [];
  const list = node.get(key);
  return isSeq(list) ? list.items : [];
}

function controllerFiles(root: string, options: ScanOptions = {}): string[] {
  return collectFiles(root, ['.controller'], options);
}

export function validateAnimatorFile(file: string, text: string, guidIndex: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  const documents = parseUnityYamlAll(text);
  const headers = [...text.matchAll(HEADER)];
  const infos: DocumentInfo[] = [];
  for (let index = 0; index < documents.length; index++) {
    const document = documents[index];
    const header = headers[index];
    if (!header || !isMap(document.contents)) continue;
    infos.push({ classId: header[1], fileId: header[2], document });
  }
  if (infos.length === 0) {
    addIssue(issues, file, 0, 1, 'No Unity YAML documents found', DiagnosticSeverity.Warning, 'animator-empty');
    return issues;
  }

  const parameterNames = new Set<string>();
  const controller = infos.find((info) => info.classId === CONTROLLER);
  if (controller) {
    const body = isMap(controller.document.contents) ? (controller.document.contents.items[0]?.value as unknown) : undefined;
    if (isMap(body)) {
      const parameters = body.get('m_AnimatorParameters');
      if (isSeq(parameters)) {
        for (const parameter of parameters.items) {
          if (!isMap(parameter)) continue;
          const name = stringValue(parameter.get('m_Name', true));
          if (!name) continue;
          if (parameterNames.has(name)) {
            const span = spanOf(parameter.get('m_Name', true));
            addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Animator parameter "${name}" is duplicated`, DiagnosticSeverity.Warning, 'animator-parameter-duplicate');
          }
          parameterNames.add(name);
        }
      }
    }
  }

  const byFileId = new Map(infos.map((info) => [info.fileId, info]));
  const byClass = new Map<string, DocumentInfo[]>();
  for (const info of infos) {
    const list = byClass.get(info.classId) ?? [];
    list.push(info);
    byClass.set(info.classId, list);
  }

  const expectClass = (node: unknown, classId: string, label: string, code: string): void => {
    const fileId = fileIdOf(node, text);
    if (!fileId || fileId === '0') return;
    const target = byFileId.get(fileId);
    const span = spanOf(node);
    if (!target) {
      addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `${label} fileID ${fileId} was not found`, DiagnosticSeverity.Warning, code);
      return;
    }
    if (target.classId !== classId) {
      addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `${label} fileID ${fileId} is not a ${classId} object`, DiagnosticSeverity.Warning, code);
    }
  };

  const checkMotion = (node: unknown): void => {
    if (!isMap(node)) return;
    const guid = guidOf(node, text)?.toLowerCase();
    if (!guid || guid === '00000000000000000000000000000000') return;
    if (!guidIndex.has(guid)) {
      const span = spanOf(node);
      addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Motion GUID ${guid} was not found`, DiagnosticSeverity.Warning, 'animator-motion-missing');
    }
  };

  for (const info of infos) {
    const body = isMap(info.document.contents) ? (info.document.contents.items[0]?.value as unknown) : undefined;
    if (!isMap(body)) continue;

    if (info.classId === CONTROLLER) {
      expectClass(body.get('m_DefaultState', true), STATE, 'Default state', 'animator-default-state');
      for (const layer of refList(body, 'm_LayerArray')) {
        if (!isMap(layer)) continue;
        expectClass(layer.get('m_StateMachine', true), STATE_MACHINE, 'Layer state machine', 'animator-layer-state-machine');
      }
    }

    if (info.classId === STATE_MACHINE) {
      for (const state of refList(body, 'm_States')) {
        if (isMap(state)) expectClass(state.get('m_State', true), STATE, 'State', 'animator-state-missing');
      }
      for (const machine of refList(body, 'm_ChildStateMachines')) {
        if (isMap(machine)) expectClass(machine.get('m_StateMachine', true), STATE_MACHINE, 'Child state machine', 'animator-child-machine');
      }
      for (const transition of refList(body, 'm_AnyStateTransitions')) {
        expectClass(transition, TRANSITION, 'Any state transition', 'animator-transition-missing');
      }
      for (const transition of refList(body, 'm_EntryTransitions')) {
        expectClass(transition, TRANSITION_ENTRY, 'Entry transition', 'animator-transition-missing');
      }
    }

    if (info.classId === TRANSITION && parameterNames.size > 0) {
      const conditions = body.get('m_Conditions');
      if (isSeq(conditions)) {
        for (const condition of conditions.items) {
          if (!isMap(condition)) continue;
          const event = stringValue(condition.get('m_ConditionEvent', true));
          if (!event || parameterNames.has(event)) continue;
          const span = spanOf(condition);
          addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Condition references missing parameter "${event}"`, DiagnosticSeverity.Warning, 'animator-condition-parameter');
        }
      }
    }

    if (info.classId === STATE) {
      for (const transition of refList(body, 'm_Transitions')) {
        if (isMap(transition)) expectClass(transition.get('m_Transition', true), TRANSITION, 'State transition', 'animator-transition-missing');
      }
      checkMotion(body.get('m_Motion', true));
    }
  }

  const edges = new Map<string, string[]>();
  for (const info of byClass.get(STATE_MACHINE) ?? []) {
    const body = isMap(info.document.contents) ? (info.document.contents.items[0]?.value as unknown) : undefined;
    if (!isMap(body)) continue;
    const targets: string[] = [];
    for (const machine of refList(body, 'm_ChildStateMachines')) {
      if (!isMap(machine)) continue;
      const fileId = fileIdOf(machine.get('m_StateMachine', true), text);
      if (fileId && byFileId.get(fileId)?.classId === STATE_MACHINE) targets.push(fileId);
    }
    edges.set(info.fileId, targets);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(node)), node];
      addIssue(issues, file, 0, 1, `State machine cycle: ${cycle.join(' -> ')}`, DiagnosticSeverity.Error, 'animator-state-machine-cycle');
      return;
    }
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of edges.get(node) ?? []) visit(next);
    stack.pop();
    state.set(node, 'done');
  };
  for (const node of edges.keys()) visit(node);

  for (const info of infos) {
    const body = isMap(info.document.contents) ? (info.document.contents.items[0]?.value as unknown) : undefined;
    if (!isMap(body)) continue;
    const unresolved = new Set<string>();
    for (const item of body.items) {
      const value = item.value;
      if (!isMap(value)) continue;
      const fileId = fileIdOf(value, text);
      if (!fileId || fileId === '0' || byFileId.has(fileId)) continue;
      if (guidOf(value, text)) continue;
      unresolved.add(fileId);
    }
    for (const fileId of unresolved) {
      addIssue(issues, file, 0, 1, `fileID ${fileId} was not found in this controller`, DiagnosticSeverity.Warning, 'animator-fileid-missing');
    }
  }
  return issues;
}

export function validateAnimators(root: string, guidIndex: Map<string, string>, options: ScanOptions = {}): Issue[] {
  const issues: Issue[] = [];
  for (const file of controllerFiles(root, options)) {
    try {
      issues.push(...validateAnimatorFile(file, readText(file), guidIndex));
    } catch (error) {
      addIssue(issues, file, 0, 1, `Unable to read animator controller: ${(error as Error).message}`, DiagnosticSeverity.Warning, 'animator-read');
    }
  }
  return issues;
}
