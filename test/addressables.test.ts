import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAddressables } from '../src/addressables.js';
import { project } from './helpers.js';
import path from 'node:path';

const SETTINGS = [
  'MonoBehaviour:',
  '  m_DefaultGroup: fb6006454d48e0442a4cf1d167a1015d',
  '  m_GroupAssets:',
  '  - {fileID: 11400000, guid: 40fa706980a477a4eabe36956c4af45f, type: 2}',
  '  - {fileID: 11400000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 2}',
  '  m_LabelTable:',
  '    m_LabelNames:',
  '    - Preload',
  '    - Preload',
  '',
].join('\n');

const GROUP = [
  'MonoBehaviour:',
  '  m_GroupName: Default Local Group',
  '  m_GUID: fb6006454d48e0442a4cf1d167a1015d',
  '  m_SerializeEntries:',
  '  - m_GUID: 11111111111111111111111111111111',
  '    m_Address: Assets/A.prefab',
  '    m_SerializedLabels:',
  '    - Preload',
  '  - m_GUID: 11111111111111111111111111111111',
  '    m_Address: Assets/A.prefab',
  '    m_SerializedLabels:',
  '    - Unknown',
  '  - m_GUID: 22222222222222222222222222222222',
  '    m_Address: Assets/Missing.prefab',
  '    m_SerializedLabels: []',
  '',
].join('\n');

describe('addressables validation', () => {
  it('reports missing entries, duplicate addresses, labels and groups', () => {
    const root = project({
      'Assets/AddressableAssetsData/AddressableAssetSettings.asset': SETTINGS,
      'Assets/AddressableAssetsData/AssetGroups/Default Local Group.asset': GROUP,
    });
    const guidIndex = new Map([
      ['40fa706980a477a4eabe36956c4af45f', path.join(root, 'Assets/AddressableAssetsData/AssetGroups/Default Local Group.asset')],
      ['11111111111111111111111111111111', path.join(root, 'Assets/A.prefab')],
    ]);
    const codes = validateAddressables(root, guidIndex).map((issue) => issue.code);
    assert.ok(codes.includes('addressables-label-duplicate'));
    assert.ok(codes.includes('addressables-group-missing'));
    assert.ok(codes.includes('addressables-entry-duplicate'));
    assert.ok(codes.includes('addressables-address-duplicate'));
    assert.ok(codes.includes('addressables-entry-missing'));
    assert.ok(codes.includes('addressables-label-missing'));
  });

  it('reports duplicate group names, missing schemas and profile problems', () => {
    const settings = [
      'MonoBehaviour:',
      '  m_DefaultGroup: fb6006454d48e0442a4cf1d167a1015d',
      '  m_GroupAssets: []',
      '  m_LabelTable:',
      '    m_LabelNames: []',
      '  m_ProfileSettings:',
      '    m_Profiles:',
      '    - m_Id: 11111111111111111111111111111111',
      '      m_ProfileName: Default',
      '      m_InheritedParent: 22222222222222222222222222222222',
      '      m_Values:',
      '      - m_Id: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '        m_Value: x',
      '    - m_Id: 33333333333333333333333333333333',
      '      m_ProfileName: Default',
      '      m_Values: []',
      '    m_ProfileEntryNames:',
      '    - m_Id: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '      m_Name: Local.BuildPath',
      '',
    ].join('\n');
    const group = (name: string, schemaGuid: string): string =>
      [
        'MonoBehaviour:',
        `  m_GroupName: ${name}`,
        `  m_GUID: ${name === 'A' ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}`,
        '  m_SchemaSet:',
        '    m_Schemas:',
        `    - {fileID: 11400000, guid: ${schemaGuid}, type: 2}`,
        '  m_SerializeEntries: []',
        '',
      ].join('\n');
    const root = project({
      'Assets/AddressableAssetsData/AddressableAssetSettings.asset': settings,
      'Assets/AddressableAssetsData/AddressableAssetSettings.asset.meta': 'fileFormatVersion: 2\nguid: cccccccccccccccccccccccccccccccc\n',
      'Assets/AddressableAssetsData/AssetGroups/A.asset': group('Same', 'dddddddddddddddddddddddddddddddd'),
      'Assets/AddressableAssetsData/AssetGroups/B.asset': group('Same', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    });
    const codes = validateAddressables(root, new Map()).map((issue) => issue.code);
    assert.ok(codes.includes('addressables-group-duplicate'));
    assert.ok(codes.includes('addressables-schema-missing'));
    assert.ok(codes.includes('addressables-profile-duplicate'));
    assert.ok(codes.includes('addressables-profile-parent'));
    assert.ok(codes.includes('addressables-profile-value'));
  });

  it('accepts a clean project', () => {
    const root = project({
      'Assets/AddressableAssetsData/AddressableAssetSettings.asset': SETTINGS.replace('    - Preload\n    - Preload\n', '    - Preload\n'),
      'Assets/AddressableAssetsData/AssetGroups/Default Local Group.asset': [
        'MonoBehaviour:',
        '  m_GroupName: Default Local Group',
        '  m_GUID: fb6006454d48e0442a4cf1d167a1015d',
        '  m_SerializeEntries:',
        '  - m_GUID: 11111111111111111111111111111111',
        '    m_Address: Assets/A.prefab',
        '    m_SerializedLabels:',
        '    - Preload',
        '',
      ].join('\n'),
    });
    const guidIndex = new Map([
      ['40fa706980a477a4eabe36956c4af45f', path.join(root, 'Assets/AddressableAssetsData/AssetGroups/Default Local Group.asset')],
      ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', path.join(root, 'Assets/Other.asset')],
      ['11111111111111111111111111111111', path.join(root, 'Assets/A.prefab')],
    ]);
    assert.deepEqual(validateAddressables(root, guidIndex), []);
  });
});
