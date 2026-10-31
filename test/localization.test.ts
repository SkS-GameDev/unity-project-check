import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalization } from '../src/localization.js';
import { parseUnityYaml } from '../src/unity-yaml.js';
import { project } from './helpers.js';

const SHARED_GUID = '277c0c9bf56b7459c8c070d53f0641a3';

const SHARED = [
  'MonoBehaviour:',
  '  m_TableCollectionName: UI',
  '  m_Entries:',
  '  - m_Id: 22149571189661696',
  '    m_Key: First',
  '  - m_Id: 22149493897027584',
  '    m_Key: First',
  '  - m_Id: 22149493897027585',
  "    m_Key: 'Multi",
  '',
  "'",
  '',
].join('\n');

const TABLE = [
  'MonoBehaviour:',
  '  m_LocaleId:',
  '    m_Code: en',
  `  m_SharedData: {fileID: 11400000, guid: ${SHARED_GUID}, type: 2}`,
  '  m_TableData:',
  '  - m_Id: 22149571189661696',
  '    m_Localized: One',
  '  - m_Id: 999',
  '    m_Localized: Orphan',
  '',
].join('\n');

describe('localization validation', () => {
  it('parses Unity multi-line quoted keys', () => {
    const doc = parseUnityYaml(SHARED);
    assert.deepEqual(doc.errors, []);
    assert.equal(doc.toJS().MonoBehaviour.m_Entries[2].m_Key, 'Multi  ');
  });

  it('reports duplicate keys, orphan and missing entries', () => {
    const root = project({
      'Assets/LocalizationSettings/Tables/UI Shared Data.asset': SHARED,
      'Assets/LocalizationSettings/Tables/UI Shared Data.asset.meta': `fileFormatVersion: 2\nguid: ${SHARED_GUID}\n`,
      'Assets/LocalizationSettings/Tables/UI_en.asset': TABLE,
    });
    const codes = validateLocalization(root).map((issue) => issue.code);
    assert.ok(codes.includes('localization-key-duplicate'));
    assert.ok(codes.includes('localization-orphan-entry'));
    assert.ok(codes.includes('localization-missing-entry'));
  });

  it('reports placeholder mismatches and collection GUID drift', () => {
    const shared = SHARED.replace(
      '  m_TableCollectionName: UI',
      '  m_TableCollectionName: UI\n  m_TableCollectionNameGuidString: 00000000000000000000000000000000'
    );
    const en = TABLE.replace('    m_Localized: One', '    m_Localized: Hello {0}');
    const ru = TABLE.replace('    m_Localized: One', '    m_Localized: Privet {1}').replace('    m_Code: en', '    m_Code: ru');
    const root = project({
      'Assets/LocalizationSettings/Tables/UI Shared Data.asset': shared,
      'Assets/LocalizationSettings/Tables/UI Shared Data.asset.meta': `fileFormatVersion: 2\nguid: ${SHARED_GUID}\n`,
      'Assets/LocalizationSettings/Tables/UI_en.asset': en,
      'Assets/LocalizationSettings/Tables/UI_ru.asset': ru,
    });
    const codes = validateLocalization(root).map((issue) => issue.code);
    assert.ok(codes.includes('localization-collection-guid'));
    assert.ok(codes.includes('localization-placeholder-mismatch'));
  });

  it('reports missing localized asset references', () => {
    const table = TABLE.replace(
      '    m_Localized: One',
      '    m_Localized: {fileID: 11400000, guid: ffffffffffffffffffffffffffffffff, type: 2}'
    );
    const root = project({
      'Assets/LocalizationSettings/Tables/UI Shared Data.asset': SHARED,
      'Assets/LocalizationSettings/Tables/UI Shared Data.asset.meta': `fileFormatVersion: 2\nguid: ${SHARED_GUID}\n`,
      'Assets/LocalizationSettings/Tables/UI_en.asset': table,
    });
    const codes = validateLocalization(root, new Map()).map((issue) => issue.code);
    assert.ok(codes.includes('localization-asset-missing'));
  });

  it('reports unresolved shared table data', () => {
    const root = project({
      'Assets/LocalizationSettings/Tables/UI Shared Data.asset': SHARED,
      'Assets/LocalizationSettings/Tables/UI_en.asset': TABLE,
    });
    const codes = validateLocalization(root).map((issue) => issue.code);
    assert.ok(codes.includes('localization-shared-missing'));
  });
});
