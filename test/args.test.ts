import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parseSize } from '../src/args.js';
import { DEFAULT_MAX_FILE_SIZE } from '../src/scan.js';

describe('cli arguments', () => {
  it('parses sizes with suffixes', () => {
    assert.equal(parseSize('20mb'), 20 * 1024 * 1024);
    assert.equal(parseSize('1kb'), 1024);
    assert.equal(parseSize('512'), 512);
    assert.equal(parseSize('nope'), DEFAULT_MAX_FILE_SIZE);
    assert.equal(parseSize(undefined), DEFAULT_MAX_FILE_SIZE);
  });

  it('enables every default section when no flags are given', () => {
    const { options } = parseArgs([]);
    assert.ok(options);
    assert.equal(options.prefabs, false);
    assert.equal(options.asmdef, true);
    assert.equal(options.animator, true);
    assert.equal(options.shadergraph, true);
  });

  it('keeps explicit sections and files', () => {
    const { options } = parseArgs(['--asmdef', '--files', 'A.asmdef', 'B.asmdef', '--json']);
    assert.ok(options);
    assert.equal(options.asmdef, true);
    assert.equal(options.manifest, false);
    assert.deepEqual(options.files, ['A.asmdef', 'B.asmdef']);
    assert.equal(options.json, true);
  });

  it('reports help and unknown arguments', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.match(parseArgs(['--nope']).error ?? '', /Unknown argument/);
  });
});
