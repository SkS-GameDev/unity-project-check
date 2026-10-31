import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkMeta } from '../src/meta.js';
import { project } from './helpers.js';

const GUID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('meta integrity', () => {
  it('accepts complete meta files', () => {
    const root = project({
      'Assets/A.txt': 'a',
      'Assets/A.txt.meta': `fileFormatVersion: 2\nguid: ${GUID}\n`,
      'Assets/Folder/F.txt': 'f',
      'Assets/Folder.meta': 'fileFormatVersion: 2\nguid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nfolderAsset: yes\n',
      'Assets/Folder/F.txt.meta': 'fileFormatVersion: 2\nguid: cccccccccccccccccccccccccccccccc\n',
    });
    assert.deepEqual(checkMeta(root), []);
  });

  it('reads CRLF and BOM meta files', () => {
    const root = project({
      'Assets/A.txt': 'a',
      'Assets/A.txt.meta': `\uFEFFfileFormatVersion: 2\r\nguid: ${GUID}\r\n`,
      'Assets/B.txt': 'b',
      'Assets/B.txt.meta': `fileFormatVersion: 2\r\nguid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\r\n`,
    });
    assert.deepEqual(checkMeta(root), []);
  });

  it('reports missing, orphan and duplicate meta files', () => {
    const root = project({
      'Assets/A.txt': 'a',
      'Assets/A.txt.meta': `fileFormatVersion: 2\nguid: ${GUID}\n`,
      'Assets/D.txt': 'd',
      'Assets/D.txt.meta': `fileFormatVersion: 2\nguid: ${GUID}\n`,
      'Assets/Orphan.txt.meta': 'fileFormatVersion: 2\nguid: dddddddddddddddddddddddddddddddd\n',
      'Assets/NoMeta.txt': 'x',
    });
    const issues = checkMeta(root);
    assert.ok(issues.some((issue) => issue.message.includes('Duplicate guid')));
    assert.ok(issues.some((issue) => issue.message.includes('Orphan')));
    assert.ok(issues.some((issue) => issue.file.endsWith('NoMeta.txt')));
  });
});
