import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePrefabs } from '../src/prefabs.js';
import { project } from './helpers.js';
import path from 'node:path';

function prefab(sourceGuid?: string, scriptGuid?: string): string {
  const lines = ['%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:'];
  if (sourceGuid) {
    lines.push('--- !u!1001 &100100000', 'PrefabInstance:', '  m_Modification:', '    m_TransformParent: {fileID: 0}',
      `    m_SourcePrefab: {fileID: 100100000, guid: ${sourceGuid}, type: 3}`);
  }
  if (scriptGuid !== undefined) {
    lines.push('--- !u!114 &11400000', 'MonoBehaviour:', `  m_Script: {fileID: ${scriptGuid === '' ? '0' : `11500000, guid: ${scriptGuid}`}, type: 3}`);
  }
  lines.push('');
  return lines.join('\n');
}

describe('prefab validation', () => {
  it('reports nested prefab cycles and missing scripts', () => {
    const root = project({
      'Assets/A.prefab': prefab('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      'Assets/B.prefab': prefab('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      'Assets/C.prefab': prefab(undefined, ''),
      'Assets/D.prefab': prefab(undefined, 'cccccccccccccccccccccccccccccccc'),
    });
    const guidIndex = new Map([
      ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', path.join(root, 'Assets/B.prefab')],
      ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', path.join(root, 'Assets/A.prefab')],
    ]);
    const codes = validatePrefabs(root, guidIndex).map((issue) => issue.code);
    assert.ok(codes.includes('prefab-cycle'));
    assert.ok(codes.includes('prefab-missing-script'));
  });

  it('reports missing source prefabs', () => {
    const root = project({
      'Assets/A.prefab': prefab('dddddddddddddddddddddddddddddddd'),
    });
    const codes = validatePrefabs(root, new Map()).map((issue) => issue.code);
    assert.ok(codes.includes('prefab-source-missing'));
  });

  it('accepts a clean prefab tree', () => {
    const root = project({
      'Assets/A.prefab': prefab(undefined, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
      'Assets/B.prefab': prefab('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    });
    const guidIndex = new Map([
      ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', path.join(root, 'Assets/A.prefab')],
      ['eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', path.join(root, 'Assets/Script.cs')],
    ]);
    assert.deepEqual(validatePrefabs(root, guidIndex), []);
  });
});
