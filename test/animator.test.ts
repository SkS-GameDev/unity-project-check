import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAnimatorFile } from '../src/animator.js';

const FILE = '/tmp/Test.controller';
const MOTION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function controller(motionGuid: string, selfCycle: boolean): string {
  return [
    '--- !u!91 &1',
    'AnimatorController:',
    '  m_DefaultState: {fileID: 2}',
    '  m_LayerArray:',
    '  - m_StateMachine: {fileID: 3}',
    '--- !u!1107 &3',
    'AnimatorStateMachine:',
    '  m_States:',
    '  - m_State: {fileID: 2}',
    '  m_ChildStateMachines:',
    '  - m_StateMachine: {fileID: 4}',
    '  m_AnyStateTransitions:',
    '  - {fileID: 5}',
    '  m_EntryTransitions:',
    '  - {fileID: 6}',
    '--- !u!1102 &2',
    'AnimatorState:',
    `  m_Motion: {fileID: 7400000, guid: ${motionGuid}, type: 2}`,
    '  m_Transitions:',
    '  - m_Transition: {fileID: 5}',
    '--- !u!1101 &5',
    'AnimatorStateTransition: {}',
    '--- !u!1109 &6',
    'AnimatorTransition: {}',
    '--- !u!1107 &4',
    'AnimatorStateMachine:',
    ...(selfCycle ? ['  m_ChildStateMachines:', '  - m_StateMachine: {fileID: 4}'] : ['  m_ChildStateMachines: []']),
    '',
  ].join('\n');
}

describe('animator controller validation', () => {
  it('accepts a consistent controller', () => {
    const guidIndex = new Map([[MOTION, '/tmp/Clip.anim']]);
    assert.deepEqual(validateAnimatorFile(FILE, controller(MOTION, false), guidIndex), []);
  });

  it('reports state machine cycles and missing motion assets', () => {
    const codes = validateAnimatorFile(FILE, controller('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', true), new Map()).map(
      (issue) => issue.code
    );
    assert.ok(codes.includes('animator-state-machine-cycle'));
    assert.ok(codes.includes('animator-motion-missing'));
  });

  it('reports conditions that reference missing parameters', () => {
    const text = [
      '--- !u!91 &1',
      'AnimatorController:',
      '  m_AnimatorParameters:',
      '  - m_Name: Speed',
      '    m_Type: 1',
      '  - m_Name: Speed',
      '    m_Type: 1',
      '--- !u!1101 &5',
      'AnimatorStateTransition:',
      '  m_Conditions:',
      '  - m_ConditionMode: 3',
      '    m_ConditionEvent: Missing',
      '',
    ].join('\n');
    const codes = validateAnimatorFile(FILE, text, new Map()).map((issue) => issue.code);
    assert.ok(codes.includes('animator-parameter-duplicate'));
    assert.ok(codes.includes('animator-condition-parameter'));
  });

  it('reports wrong default state classes and missing fileIDs', () => {
    const text = [
      '--- !u!91 &1',
      'AnimatorController:',
      '  m_DefaultState: {fileID: 7}',
      '--- !u!1107 &7',
      'AnimatorStateMachine: {}',
      '--- !u!1107 &8',
      'AnimatorStateMachine:',
      '  m_States:',
      '  - m_State: {fileID: 99}',
      '',
    ].join('\n');
    const codes = validateAnimatorFile(FILE, text, new Map()).map((issue) => issue.code);
    assert.ok(codes.includes('animator-default-state'));
    assert.ok(codes.includes('animator-state-missing'));
  });
});
