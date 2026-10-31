import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.js';
import { project } from './helpers.js';
import path from 'node:path';

function capture(): { lines: string[]; restore: () => void } {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  return { lines, restore: () => (console.log = original) };
}

const BROKEN = JSON.stringify({ name: 'A', references: ['Missing'] });
const DUPLICATE = JSON.stringify({ name: 'A', references: [] });

describe('unity-project-check cli', () => {
  it('reports errors, json and sarif', async () => {
    const root = project({
      'Assets/A/A.asmdef': BROKEN,
      'Assets/B/B.asmdef': DUPLICATE,
    });
    const captured = capture();
    const code = await run(['--project', root, '--json']);
    captured.restore();
    assert.equal(code, 1);
    const report = JSON.parse(captured.lines.join('\n'));
    assert.equal(report.errors, 2);
    assert.ok(report.warnings >= 1);

    const sarif = capture();
    const sarifCode = await run(['--project', root, '--sarif']);
    sarif.restore();
    assert.equal(sarifCode, 1);
    const parsed = JSON.parse(sarif.lines.join('\n'));
    assert.equal(parsed.version, '2.1.0');
    assert.ok(parsed.runs[0].results.length >= 2);
  });

  it('writes and applies a baseline', async () => {
    const root = project({ 'Assets/A/A.asmdef': BROKEN, 'Assets/B/B.asmdef': DUPLICATE });
    const baseline = path.join(root, 'baseline.json');
    const write = capture();
    const writeCode = await run(['--project', root, '--write-baseline', baseline]);
    write.restore();
    assert.equal(writeCode, 0);

    const apply = capture();
    const code = await run(['--project', root, '--baseline', baseline]);
    apply.restore();
    assert.equal(code, 0);
    assert.match(apply.lines.join('\n'), /\d+ baselined/);
  });

  it('validates only the given files', async () => {
    const root = project({
      'Assets/A/A.asmdef': BROKEN,
      'Assets/B/B.asmdef': DUPLICATE,
      'Assets/C/C.asmdef': JSON.stringify({ name: 'C', references: ['A'] }),
    });
    const captured = capture();
    const code = await run(['--project', root, '--json', '--files', path.join(root, 'Assets/C/C.asmdef')]);
    captured.restore();
    assert.equal(code, 0);
    const report = JSON.parse(captured.lines.join('\n'));
    assert.equal(report.issues.length, 0);
  });

  it('parses max file size suffixes', async () => {
    const root = project({ 'Assets/A/A.asmdef': BROKEN });
    const captured = capture();
    const code = await run(['--project', root, '--json', '--asmdef', '--max-file-size', '1kb']);
    captured.restore();
    assert.equal(code, 0);
    const report = JSON.parse(captured.lines.join('\n'));
    assert.equal(report.issues.length, 1);
  });
});
