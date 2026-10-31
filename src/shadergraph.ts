import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { readText } from './project.js';
import { collectFiles, type ScanOptions } from './scan.js';
import { addIssue } from './types.js';

const HEX_ID = /^[0-9a-f]{32}$/;

interface JsonDocument {
  value: Record<string, unknown>;
  start: number;
}

function jsonDocuments(text: string): JsonDocument[] {
  const result: JsonDocument[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index++;
    if (index >= text.length) break;
    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; index < text.length; index++) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth++;
      else if (character === '}') {
        depth--;
        if (depth === 0) {
          index++;
          break;
        }
      }
    }
    if (depth !== 0) throw new Error('Unterminated JSON object');
    result.push({ value: JSON.parse(text.slice(start, index)) as Record<string, unknown>, start });
  }
  return result;
}

function shaderGraphFiles(root: string, options: ScanOptions = {}): string[] {
  return collectFiles(root, ['.shadergraph'], options);
}

function collectReferenceIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceIds(item, into);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === 'm_Id' && typeof record.m_Id === 'string' && HEX_ID.test(record.m_Id)) {
    into.add(record.m_Id);
    return;
  }
  for (const item of Object.values(record)) collectReferenceIds(item, into);
}

export function validateShaderGraphFile(file: string, text: string, guidIndex?: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  let documents: JsonDocument[];
  try {
    documents = jsonDocuments(text);
  } catch (error) {
    addIssue(issues, file, 0, 1, `JSON: ${(error as Error).message}`, DiagnosticSeverity.Error, 'shadergraph-json');
    return issues;
  }
  if (documents.length === 0) {
    addIssue(issues, file, 0, 1, 'ShaderGraph file is empty', DiagnosticSeverity.Error, 'shadergraph-json');
    return issues;
  }

  const byId = new Map<string, JsonDocument>();
  for (const document of documents) {
    const objectId = document.value.m_ObjectId;
    if (typeof objectId !== 'string' || !HEX_ID.test(objectId)) {
      addIssue(issues, file, document.start, document.start + 1, 'ShaderGraph object has no m_ObjectId', DiagnosticSeverity.Warning, 'shadergraph-object-id');
      continue;
    }
    if (byId.has(objectId)) {
      addIssue(issues, file, document.start, document.start + 1, `Duplicate m_ObjectId ${objectId}`, DiagnosticSeverity.Error, 'shadergraph-object-duplicate');
      continue;
    }
    byId.set(objectId, document);
  }

  if (guidIndex) {
    for (const document of documents) {
      const type = document.value.m_Type;
      if (typeof type !== 'string' || !type.endsWith('SubGraphNode')) continue;
      const serialized = document.value.m_SerializedSubGraph;
      if (typeof serialized !== 'string') continue;
      try {
        const reference = JSON.parse(serialized) as { subGraph?: { guid?: string } };
        const guid = reference.subGraph?.guid?.toLowerCase();
        if (guid && guid !== '00000000000000000000000000000000' && !guidIndex.has(guid)) {
          addIssue(issues, file, document.start, document.start + 1, `Subgraph GUID ${guid} was not found`, DiagnosticSeverity.Warning, 'shadergraph-subgraph-missing');
        }
      } catch {
        addIssue(issues, file, document.start, document.start + 1, 'm_SerializedSubGraph is not valid JSON', DiagnosticSeverity.Warning, 'shadergraph-subgraph-json');
      }
    }
  }

  const graph = documents.find((document) => typeof document.value.m_Type === 'string' && (document.value.m_Type as string).endsWith('GraphData'));
  if (!graph) {
    addIssue(issues, file, documents[0].start, documents[0].start + 1, 'GraphData object is missing', DiagnosticSeverity.Error, 'shadergraph-graph-missing');
    return issues;
  }

  const referenced = new Set<string>();
  collectReferenceIds(graph.value, referenced);
  for (const id of referenced) {
    if (!byId.has(id)) {
      addIssue(issues, file, graph.start, graph.start + 1, `Graph reference ${id} was not found`, DiagnosticSeverity.Warning, 'shadergraph-reference-missing');
    }
  }

  const nodeSlots = new Map<string, Set<number>>();
  for (const [id, document] of byId) {
    const slots = document.value.m_SerializableSlots;
    if (!Array.isArray(slots)) continue;
    const ids = new Set<number>();
    for (const slot of slots) {
      if (!slot || typeof slot !== 'object') continue;
      const slotId = (slot as Record<string, unknown>).m_Id;
      if (typeof slotId !== 'string') continue;
      const slotDocument = byId.get(slotId);
      const numeric = slotDocument?.value.m_Id;
      if (typeof numeric === 'number') ids.add(numeric);
    }
    nodeSlots.set(id, ids);
  }

  const edgeReferences = Array.isArray(graph.value.m_Edges) ? graph.value.m_Edges : [];
  for (const edgeReference of edgeReferences) {
    const edgeId = (edgeReference as Record<string, unknown>)?.m_Id;
    if (typeof edgeId !== 'string') continue;
    const edge = byId.get(edgeId)?.value;
    if (!edge) continue;
    for (const key of ['m_OutputSlot', 'm_InputSlot']) {
      const endpoint = edge[key] as Record<string, unknown> | undefined;
      if (!endpoint) continue;
      const nodeId = endpoint.m_NodeGUIDSerialized;
      const slotId = endpoint.m_SlotId;
      if (typeof nodeId !== 'string' || !byId.has(nodeId)) {
        addIssue(issues, file, graph.start, graph.start + 1, `Edge ${edgeId} references a missing node`, DiagnosticSeverity.Warning, 'shadergraph-edge-node');
        continue;
      }
      const slots = nodeSlots.get(nodeId);
      if (slots && typeof slotId === 'number' && !slots.has(slotId)) {
        addIssue(issues, file, graph.start, graph.start + 1, `Edge ${edgeId} references missing slot ${slotId}`, DiagnosticSeverity.Warning, 'shadergraph-edge-slot');
      }
    }
  }

  const names = new Map<string, string>();
  const properties = Array.isArray(graph.value.m_Properties) ? graph.value.m_Properties : [];
  for (const propertyReference of properties) {
    const propertyId = (propertyReference as Record<string, unknown>)?.m_Id;
    if (typeof propertyId !== 'string') continue;
    const property = byId.get(propertyId)?.value;
    if (!property) continue;
    const name = typeof property.m_OverrideReferenceName === 'string' && property.m_OverrideReferenceName.length > 0
      ? property.m_OverrideReferenceName
      : typeof property.m_ReferenceName === 'string'
        ? property.m_ReferenceName
        : undefined;
    if (!name) continue;
    if (names.has(name)) {
      addIssue(issues, file, graph.start, graph.start + 1, `Property reference name "${name}" is duplicated`, DiagnosticSeverity.Warning, 'shadergraph-property-duplicate');
    }
    names.set(name, propertyId);
  }
  return issues;
}

export function validateShaderGraphs(root: string, options: ScanOptions = {}, guidIndex?: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  for (const file of shaderGraphFiles(root, options)) {
    try {
      issues.push(...validateShaderGraphFile(file, readText(file), guidIndex));
    } catch (error) {
      addIssue(issues, file, 0, 1, `Unable to read shader graph: ${(error as Error).message}`, DiagnosticSeverity.Warning, 'shadergraph-read');
    }
  }
  return issues;
}
