import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { inferInterface } from '@engine/execution/interface.ts';
import { derivedOutputWords } from './derivedOutput';
import { nodeFacts } from './nodeFacts';

const wire = (source: string, target: string, targetHandle = 'input') =>
  ({ id: `${source}-${target}`, source, sourceHandle: 'output', target, targetHandle });

describe('what comes out, as the graph already says it', () => {
  it('carries a Text data node\'s format details, which "Use this format" dropped for "Plain text."', () => {
    const words = NODE_KINDS.data.create('words');
    words.label = 'Words';
    words.description = 'one word per line, lowercase';
    const code = NODE_KINDS.code.create('split');

    const derived = derivedOutputWords(code, [code, words], [wire('split', 'words')]);
    expect(derived).toContain('"Words"');
    expect(derived).toContain('text: one word per line, lowercase');
  });

  it('adds the shape a run kept, and says nothing when the graph says nothing', () => {
    const code = NODE_KINDS.code.create('count');
    expect(derivedOutputWords(code, [code], [])).toBe('');
    code.config.output_schema = inferInterface({ output: 3 });
    expect(derivedOutputWords(code, [code], [])).toMatch(/^So far it has returned /);
  });

  it('is what ✨ is told, whether or not anyone writes a word', () => {
    const words = NODE_KINDS.data.create('words');
    words.label = 'Words';
    words.description = 'one word per line, lowercase';
    const code = NODE_KINDS.code.create('split');
    const facts = nodeFacts(code, [code, words], [wire('split', 'words')], null);
    expect(facts.outputTargets?.output).toContain('text: one word per line, lowercase');
  });
});
