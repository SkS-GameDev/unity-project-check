import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateInputActionsFile } from '../src/inputactions.js';

const FILE = '/tmp/Test.inputactions';

function asset(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'Test',
    maps: [
      {
        name: 'Gameplay',
        id: '11111111-1111-1111-1111-111111111111',
        actions: [
          { name: 'Jump', type: 'Button', id: '22222222-2222-2222-2222-222222222222' },
          { name: 'Jump', type: 'Button', id: '33333333-3333-3333-3333-333333333333' },
        ],
        bindings: [
          { name: '', path: '<Keyboard>/space', action: 'Jump', id: '44444444-4444-4444-4444-444444444444' },
          { name: '', path: '', action: 'Missing', id: '44444444-4444-4444-4444-444444444444' },
        ],
      },
      {
        name: 'Gameplay',
        id: '55555555-5555-5555-5555-555555555555',
        actions: [],
        bindings: [],
      },
    ],
    controlSchemes: [],
    ...overrides,
  });
}

describe('input actions validation', () => {
  it('reports duplicate maps, actions, ids and missing binding actions', () => {
    const codes = validateInputActionsFile(FILE, asset()).map((issue) => issue.code);
    assert.ok(codes.includes('inputactions-map-duplicate'));
    assert.ok(codes.includes('inputactions-action-duplicate'));
    assert.ok(codes.includes('inputactions-id-duplicate'));
    assert.ok(codes.includes('inputactions-binding-action'));
    assert.ok(codes.includes('inputactions-binding-path'));
  });

  it('accepts a clean asset without a version field', () => {
    const clean = JSON.stringify({
      name: 'Test',
      maps: [
        {
          name: 'Gameplay',
          actions: [{ name: 'Jump', id: 'a' }],
          bindings: [
            { name: '', path: '<Keyboard>/space', action: 'Jump', id: 'b' },
            { name: 'WASD', path: '', action: 'Jump', isComposite: true, id: 'c' },
            { name: 'Up', path: '<Keyboard>/w', action: 'Jump', isPartOfComposite: true, id: 'd' },
          ],
        },
      ],
      controlSchemes: [],
    });
    assert.deepEqual(validateInputActionsFile(FILE, clean), []);
  });

  it('reports unknown binding groups, bad paths and orphan composite parts', () => {
    const text = JSON.stringify({
      maps: [
        {
          name: 'Gameplay',
          actions: [{ name: 'Move', id: 'a' }],
          bindings: [
            { path: 'LeftStick', action: 'Move', groups: 'UnknownScheme', id: 'b' },
            { path: '<Gamepad>/leftStick', action: 'Move', groups: 'Gamepad', id: 'c' },
            { path: '<Gamepad>/leftStick/up', action: 'Move', isPartOfComposite: true, id: 'd' },
          ],
        },
      ],
      controlSchemes: [{ name: 'Gamepad' }],
    });
    const codes = validateInputActionsFile(FILE, text).map((issue) => issue.code);
    assert.ok(codes.includes('inputactions-binding-group'));
    assert.ok(codes.includes('inputactions-binding-path-syntax'));
    assert.ok(codes.includes('inputactions-composite-part'));
  });

  it('reports malformed JSON', () => {
    assert.equal(validateInputActionsFile(FILE, '{ broken')[0].code, 'inputactions-json');
  });
});
