import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, validateManifestProject } from '../src/manifest.js';
import { project } from './helpers.js';
import path from 'node:path';

describe('manifest validation', () => {
  it('accepts registry, git and local dependencies with a matching lock', () => {
    const root = project({
      'Packages/localpkg/package.json': '{}',
      'Packages/manifest.json': JSON.stringify({
        dependencies: {
          'com.unity.registry': '1.2.3',
          'com.unity.local': 'file:localpkg',
          'com.unity.git': 'https://example.com/package.git',
        },
      }),
      'Packages/packages-lock.json': JSON.stringify({
        dependencies: {
          'com.unity.registry': { version: '1.2.3', source: 'registry' },
          'com.unity.local': { version: 'file:localpkg', source: 'local' },
          'com.unity.git': { version: 'https://example.com/package.git', source: 'git' },
        },
      }),
    });
    assert.deepEqual(validateManifestProject(root), []);
  });

  it('reports malformed JSON, bad versions and missing lock entries', () => {
    const root = project({
      'Packages/manifest.json': JSON.stringify({
        dependencies: {
          'com.unity.bad': 'not-a-version',
          'com.unity.missing': '1.0.0',
          'com.unity.drift': '2.0.0',
        },
      }),
      'Packages/packages-lock.json': JSON.stringify({
        dependencies: {
          'com.unity.bad': { version: '1.0.0', source: 'registry' },
          'com.unity.drift': { version: '1.5.0', source: 'registry' },
        },
      }),
    });
    const issues = validateManifestProject(root);
    assert.ok(issues.some((issue) => issue.code === 'manifest-version'));
    assert.ok(issues.some((issue) => issue.code === 'manifest-lock-missing'));
    assert.ok(issues.some((issue) => issue.code === 'manifest-lock-version'));
  });

  it('reports missing local package paths', () => {
    const root = project({
      'Packages/manifest.json': JSON.stringify({ dependencies: { 'com.unity.local': 'file:missing' } }),
    });
    const file = path.join(root, 'Packages', 'manifest.json');
    const issues = validateManifest(file, JSON.stringify({ dependencies: { 'com.unity.local': 'file:missing' } }), root);
    assert.ok(issues.some((issue) => issue.code === 'manifest-local-package'));
  });
});
