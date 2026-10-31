import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGraphicsSettings,
  validateProjectVersion,
  validateSettingsProject,
  validateTagManager,
} from '../src/settings.js';
import {
  validateInputManager,
  validatePhysicsSettings,
  validatePlayerSettings,
  validateQualitySettings,
} from '../src/settings-extra.js';
import { project } from './helpers.js';
import path from 'node:path';

describe('project settings validation', () => {
  it('accepts a valid ProjectVersion', () => {
    const file = '/tmp/ProjectVersion.txt';
    assert.deepEqual(validateProjectVersion(file, 'm_EditorVersion: 6000.2.13f1\n'), []);
    assert.equal(validateProjectVersion(file, 'm_EditorVersion: 6000\n')[0].code, 'settings-version');
    assert.equal(validateProjectVersion(file, 'other: 1\n')[0].code, 'settings-version');
  });

  it('reports duplicate tags, layers and sorting layers', () => {
    const text = [
      'TagManager:',
      '  tags:',
      '  - enemy',
      '  - enemy',
      '  layers:',
      ...Array.from({ length: 32 }, (_, index) => `  - ${index < 2 ? 'Dup' : index === 2 ? '' : `Layer${index}`}`),
      '  m_SortingLayers:',
      '  - name: UI',
      '  - name: UI',
      '',
    ].join('\n');
    const codes = validateTagManager('/tmp/TagManager.asset', text).map((issue) => issue.code);
    assert.ok(codes.includes('settings-tag-duplicate'));
    assert.ok(codes.includes('settings-layer-duplicate'));
    assert.ok(codes.includes('settings-sorting-layer-duplicate'));
  });

  it('reports missing and duplicate build scenes', () => {
    const root = project({
      'Assets/Scenes/A.unity': '',
      'ProjectSettings/EditorBuildSettings.asset': [
        'EditorBuildSettings:',
        '  m_Scenes:',
        '  - enabled: 1',
        '    path: Assets/Scenes/A.unity',
        '    guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '  - enabled: 1',
        '    path: Assets/Scenes/A.unity',
        '    guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '  - enabled: 1',
        '    path: Assets/Scenes/Missing.unity',
        '    guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '',
      ].join('\n'),
    });
    const codes = validateSettingsProject(root).map((issue) => issue.code);
    assert.ok(codes.includes('settings-scene-duplicate'));
    assert.ok(codes.includes('settings-scene-missing'));
  });

  it('reports schema version drift', () => {
    const root = project({
      'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.2.13f1\n',
      'Library/UnityYaml/schema.json': JSON.stringify({ unityVersion: '2022.3.1f1' }),
    });
    const issues = validateSettingsProject(root, new Map());
    assert.ok(issues.some((issue) => issue.code === 'schema-version'));

    const matching = project({
      'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.2.13f1\n',
      'Library/UnityYaml/schema.json': JSON.stringify({ unityVersion: '6000.2.13f1' }),
    });
    assert.deepEqual(validateSettingsProject(matching, new Map()), []);
  });

  it('validates PlayerSettings fields', () => {
    const valid = [
      'PlayerSettings:',
      '  productName: Game',
      '  companyName: Studio',
      '  bundleVersion: 1.2.3',
      '  activeInputHandler: 2',
      '  scriptingBackend:',
      '    Standalone: 1',
      '',
    ].join('\n');
    assert.deepEqual(validatePlayerSettings('/tmp/ProjectSettings.asset', valid), []);
    const invalid = [
      'PlayerSettings:',
      '  productName: ""',
      '  companyName: ""',
      '  bundleVersion: beta',
      '  activeInputHandler: 9',
      '  scriptingBackend:',
      '    Standalone: 7',
      '',
    ].join('\n');
    const codes = validatePlayerSettings('/tmp/ProjectSettings.asset', invalid).map((issue) => issue.code);
    assert.ok(codes.includes('settings-product-name'));
    assert.ok(codes.includes('settings-company-name'));
    assert.ok(codes.includes('settings-bundle-version'));
    assert.ok(codes.includes('settings-input-handler'));
    assert.ok(codes.includes('settings-scripting-backend'));
  });

  it('validates QualitySettings and InputManager', () => {
    const quality = [
      'QualitySettings:',
      '  m_CurrentQuality: 2',
      '  m_QualitySettings:',
      '  - name: Low',
      '  - name: Low',
      '',
    ].join('\n');
    const qualityCodes = validateQualitySettings('/tmp/QualitySettings.asset', quality).map((issue) => issue.code);
    assert.ok(qualityCodes.includes('settings-quality-duplicate'));
    assert.ok(qualityCodes.includes('settings-quality-index'));

    const input = [
      'InputManager:',
      '  m_Axes:',
      '  - m_Name: Jump',
      '    type: 0',
      '    positiveButton: space',
      '  - m_Name: Jump',
      '    type: 0',
      '    positiveButton: ""',
      '  - m_Name: Mouse X',
      '    type: 1',
      '',
    ].join('\n');
    const inputCodes = validateInputManager('/tmp/InputManager.asset', input).map((issue) => issue.code);
    assert.ok(inputCodes.includes('settings-axis-duplicate'));
    assert.equal(inputCodes.filter((code) => code === 'settings-axis-buttons').length, 1);
  });

  it('validates the collision matrix length', () => {
    const valid = ['PhysicsManager:', '  m_LayerCollisionMatrix: ' + 'f'.repeat(256), ''].join('\n');
    assert.deepEqual(validatePhysicsSettings('/tmp/DynamicsManager.asset', valid), []);
    const invalid = ['PhysicsManager:', '  m_LayerCollisionMatrix: ff', ''].join('\n');
    assert.equal(validatePhysicsSettings('/tmp/DynamicsManager.asset', invalid)[0].code, 'settings-collision-matrix');
  });

  it('reports an unresolved render pipeline asset', () => {
    const root = project({
      'Assets/Pipeline.asset': '',
      'Assets/Pipeline.asset.meta': 'fileFormatVersion: 2\nguid: cccccccccccccccccccccccccccccccc\n',
    });
    const ok = validateGraphicsSettings(
      path.join(root, 'ProjectSettings/GraphicsSettings.asset'),
      'GraphicsSettings:\n  m_CustomRenderPipeline: {fileID: 11400000, guid: cccccccccccccccccccccccccccccccc, type: 2}\n',
      new Map([['cccccccccccccccccccccccccccccccc', path.join(root, 'Assets/Pipeline.asset')]])
    );
    assert.deepEqual(ok, []);

    const missing = validateGraphicsSettings(
      path.join(root, 'ProjectSettings/GraphicsSettings.asset'),
      'GraphicsSettings:\n  m_CustomRenderPipeline: {fileID: 11400000, guid: dddddddddddddddddddddddddddddddd, type: 2}\n',
      new Map()
    );
    assert.equal(missing[0].code, 'settings-render-pipeline');
  });
});
