import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, scanAsmdefs } from '../src/project.js';
import { referenceAt, validateProject } from '../src/asmdef.js';
import { project } from './helpers.js';
import path from 'node:path';

const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('asmdef validation', () => {
  it('accepts valid name and guid references', () => {
    const root = project({
      'Assets/A/A.asmdef': JSON.stringify({ name: 'A', references: [] }),
      'Assets/A/A.asmdef.meta': `fileFormatVersion: 2\nguid: ${GUID_A}\n`,
      'Assets/B/B.asmdef': JSON.stringify({ name: 'B', references: [`GUID:${GUID_A}`] }),
      'Assets/B/B.asmdef.meta': `fileFormatVersion: 2\nguid: ${GUID_B}\n`,
    });
    assert.deepEqual(validateProject(root), []);
  });

  it('reports unresolved references and self references', () => {
    const root = project({
      'Assets/A/A.asmdef': JSON.stringify({ name: 'A', references: ['Missing', 'GUID:cccccccccccccccccccccccccccccccc'] }),
      'Assets/A/A.asmdef.meta': `fileFormatVersion: 2\nguid: ${GUID_A}\n`,
    });
    const issues = validateProject(root);
    assert.equal(issues.filter((issue) => issue.code === 'asmdef-unresolved-reference').length, 2);
  });

  it('reports duplicate names, cycles and malformed JSON', () => {
    const root = project({
      'Assets/A/A.asmdef': JSON.stringify({ name: 'A', references: ['B'] }),
      'Assets/B/B.asmdef': JSON.stringify({ name: 'B', references: ['A'] }),
      'Assets/C/C.asmdef': JSON.stringify({ name: 'A', references: [] }),
      'Assets/D/D.asmdef': '{ not json',
    });
    const issues = validateProject(root);
    assert.ok(issues.some((issue) => issue.code === 'asmdef-duplicate-name'));
    assert.ok(issues.some((issue) => issue.code === 'asmdef-cycle'));
    assert.ok(issues.some((issue) => issue.code === 'asmdef-json'));
  });

  it('validates asmref files', () => {
    const root = project({
      'Assets/A/A.asmdef': JSON.stringify({ name: 'A', references: [] }),
      'Assets/A/A.asmdef.meta': `fileFormatVersion: 2\nguid: ${GUID_A}\n`,
      'Assets/B/B.asmref': JSON.stringify({ reference: 'A' }),
      'Assets/C/C.asmref': JSON.stringify({ reference: 'Missing' }),
    });
    const issues = validateProject(root);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, 'asmref-unresolved');
  });

  it('reads UTF-8 BOM asmdefs and ignores Samples~ folders', () => {
    const root = project({
      'Assets/A/A.asmdef': '\uFEFF' + JSON.stringify({ name: 'A', references: [] }),
      'Assets/B/B.asmdef': JSON.stringify({ name: 'B', references: ['A'] }),
      'Library/PackageCache/pkg@1/Samples~/Demo/Demo.asmdef': JSON.stringify({ name: 'A', references: [] }),
    });
    const issues = validateProject(root);
    assert.deepEqual(issues, []);
  });

  it('resolves a reference at the cursor', () => {
    const root = project({
      'Assets/A/A.asmdef': JSON.stringify({ name: 'A', references: [] }),
      'Assets/A/A.asmdef.meta': `fileFormatVersion: 2\nguid: ${GUID_A}\n`,
      'Assets/B/B.asmdef': JSON.stringify({ name: 'B', references: [`GUID:${GUID_A}`] }),
      'Assets/B/B.asmdef.meta': `fileFormatVersion: 2\nguid: ${GUID_B}\n`,
    });
    const asmdefs = scanAsmdefs(root);
    const index = buildIndex(asmdefs);
    const text = JSON.stringify({ name: 'B', references: [`GUID:${GUID_A}`] });
    const target = referenceAt(path.join(root, 'Assets/B/B.asmdef'), text, text.indexOf(GUID_A), index);
    assert.equal(target?.name, 'A');
  });
});
