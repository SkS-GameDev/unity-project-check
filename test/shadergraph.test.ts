import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateShaderGraphFile, validateShaderGraphs } from '../src/shadergraph.js';
import { project } from './helpers.js';

const GRAPH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NODE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SLOT = 'cccccccccccccccccccccccccccccccc';
const EDGE = 'dddddddddddddddddddddddddddddddd';
const PROPERTY = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function graphFile(overrides: Record<string, unknown> = {}, documents: Record<string, unknown>[] = []): string {
  const graph = {
    m_SGVersion: 3,
    m_Type: 'UnityEditor.ShaderGraph.GraphData',
    m_ObjectId: GRAPH,
    m_Properties: [{ m_Id: PROPERTY }],
    m_Nodes: [{ m_Id: NODE }],
    m_Edges: [{ m_Id: EDGE }],
    m_ActiveTargets: [],
    ...overrides,
  };
  const defaults: Record<string, unknown>[] = [
    {
      m_SGVersion: 0,
      m_Type: 'UnityEditor.ShaderGraph.Vector1Node',
      m_ObjectId: NODE,
      m_SerializableSlots: [{ m_Id: SLOT }],
    },
    {
      m_SGVersion: 0,
      m_Type: 'UnityEditor.ShaderGraph.Vector1MaterialSlot',
      m_ObjectId: SLOT,
      m_Id: 1,
    },
    {
      m_SGVersion: 0,
      m_Type: 'UnityEditor.ShaderGraph.Edge',
      m_ObjectId: EDGE,
      m_OutputSlot: { m_NodeGUIDSerialized: NODE, m_SlotId: 1 },
      m_InputSlot: { m_NodeGUIDSerialized: NODE, m_SlotId: 1 },
    },
    {
      m_SGVersion: 0,
      m_Type: 'UnityEditor.ShaderGraph.Vector1ShaderProperty',
      m_ObjectId: PROPERTY,
      m_ReferenceName: '_Value',
    },
  ];
  return [graph, ...defaults, ...documents].map((document) => JSON.stringify(document, null, 4)).join('\n\n');
}

describe('shader graph validation', () => {
  it('accepts a consistent graph', () => {
    const root = project({ 'Assets/G.shadergraph': graphFile() });
    assert.deepEqual(validateShaderGraphs(root), []);
  });

  it('reports duplicate object ids and missing references', () => {
    const file = '/tmp/G.shadergraph';
    const text = graphFile({ m_Nodes: [{ m_Id: 'ffffffffffffffffffffffffffffffff' }] }, [
      { m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_ObjectId: NODE, m_SerializableSlots: [] },
    ]);
    const codes = validateShaderGraphFile(file, text).map((issue) => issue.code);
    assert.ok(codes.includes('shadergraph-object-duplicate'));
    assert.ok(codes.includes('shadergraph-reference-missing'));
  });

  it('reports edges that point to missing nodes or slots', () => {
    const file = '/tmp/G.shadergraph';
    const text = graphFile({ m_Edges: [{ m_Id: EDGE }, { m_Id: 'ffffffffffffffffffffffffffffffff' }] }, [
      {
        m_Type: 'UnityEditor.ShaderGraph.Edge',
        m_ObjectId: 'ffffffffffffffffffffffffffffffff',
        m_OutputSlot: { m_NodeGUIDSerialized: '00000000000000000000000000000000', m_SlotId: 1 },
        m_InputSlot: { m_NodeGUIDSerialized: NODE, m_SlotId: 42 },
      },
    ]);
    const codes = validateShaderGraphFile(file, text).map((issue) => issue.code);
    assert.ok(codes.includes('shadergraph-edge-node'));
    assert.ok(codes.includes('shadergraph-edge-slot'));
  });

  it('reports missing subgraph assets', () => {
    const file = '/tmp/G.shadergraph';
    const subgraph = 'ffffffffffffffffffffffffffffffff';
    const text = graphFile({ m_Nodes: [{ m_Id: subgraph }] }, [
      {
        m_Type: 'UnityEditor.ShaderGraph.SubGraphNode',
        m_ObjectId: subgraph,
        m_SerializedSubGraph: JSON.stringify({ subGraph: { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } }),
      },
    ]);
    assert.equal(validateShaderGraphFile(file, text, new Map())[0].code, 'shadergraph-subgraph-missing');
    assert.deepEqual(validateShaderGraphFile(file, text, new Map([['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '/tmp/S.shadergraph']])), []);
  });

  it('reports duplicate property reference names and malformed JSON', () => {
    const file = '/tmp/G.shadergraph';
    const second = 'ffffffffffffffffffffffffffffffff';
    const text = graphFile({ m_Properties: [{ m_Id: PROPERTY }, { m_Id: second }] }, [
      { m_Type: 'UnityEditor.ShaderGraph.Vector1ShaderProperty', m_ObjectId: second, m_ReferenceName: '_Value' },
    ]);
    const codes = validateShaderGraphFile(file, text).map((issue) => issue.code);
    assert.ok(codes.includes('shadergraph-property-duplicate'));
    assert.equal(validateShaderGraphFile(file, '{ broken')[0].code, 'shadergraph-json');
  });
});
