import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import { generateRequest, nodeFields } from './generation';

describe('the request ✨ Generate sends', () => {
  const node = NODE_KINDS.code.create('worker');
  node.config.code_prompt = 'Sum the sizes';
  node.inputs[0].description = 'one file per row, with a size';
  node.outputs[0].description = '';
  node.config.examples = '## one\n```json input\n{"input": 1}\n```';
  node.config.output_schema = { type: 'object' };
  const fields = nodeFields(node, () => {}, () => {});

  const request = generateRequest({
    element: 'code',
    generation: NODE_BUILDERS.code.generation!,
    subject: node,
    fields,
    portNotes: {
      inputs: Object.fromEntries(node.inputs.map((p) => [p.id, p.description])),
      outputs: Object.fromEntries(node.outputs.map((p) => [p.id, p.description])),
    },
    outputSchema: node.config.output_schema,
    examples: node.config.examples,
  });

  it('carries what the dialog says about the ports, leaving out the empty ones', () => {
    expect(request.input_notes).toEqual({ input: 'one file per row, with a size' });
    expect(request.output_notes).toBeUndefined();
  });

  it('carries the kept shape and the examples', () => {
    expect(request.output_schema).toEqual({ type: 'object' });
    expect(request.examples).toContain('## one');
  });

  it('is what the preview asks for too: the preview only adds the flag', () => {
    expect(request.description).toBe('Sum the sizes');
    expect('preview' in request).toBe(false);
  });
});
