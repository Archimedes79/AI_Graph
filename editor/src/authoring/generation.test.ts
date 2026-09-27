import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import type { ProbeReport } from '@/api/client';
import { generateRequest, nodeFields, probeMessage } from './generation';
import { nodeFacts } from './nodeFacts';

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

  it('says which ports are declared lists, so the probe cuts and collects as a run does', () => {
    const worker = NODE_KINDS.code.create('worker');
    worker.inputs.push({ ...worker.inputs[0], id: 'stop', name: 'stop', multi: false });
    worker.outputs.push({ ...worker.outputs[0], id: 'count', name: 'count', multi: false });
    const sent = generateRequest({
      element: 'code', generation: NODE_BUILDERS.code.generation!, subject: worker, fields: nodeFields(worker, () => {}, () => {}),
      ...nodeFacts(worker, [worker], [], null),
    });
    expect(sent.multi_inputs).toEqual(['input']);
    expect(sent.multi_outputs).toEqual(['output']);
  });
});

describe('what is said after ✨', () => {
  const report = (probe: Partial<ProbeReport>): ProbeReport => ({ status: 'failed', attempts: 2, error: '', missing_outputs: [], output_preview: '', ...probe });

  it('names the sample it was verified on, which was always said to be "the last run\'s data"', () => {
    expect(probeMessage(report({ status: 'ok' }), 'done', 'the example in step 1')).toBe('✅ Generated and verified against the example in step 1.');
    expect(probeMessage(report({ status: 'repaired' }), 'done', 'what "Rows" holds now')).toContain('failed on what "Rows" holds now');
  });

  it('says what is wrong with a result that runs, instead of "missing " with nothing after it', () => {
    const said = probeMessage(report({ problems: ['a label runs off the chart'] }), 'done', 'the last run');
    expect(said).toBe('⚠️ Generated and it runs on the last run, but the result is not right yet: a label runs off the chart');
    expect(probeMessage(report({ missing_outputs: ['figure'] }), 'done')).toBe('⚠️ Generated, but it does not return figure yet.');
    expect(probeMessage(report({ error: 'x is not defined' }), 'done')).toBe('⚠️ Generated, but it does not run yet: x is not defined');
  });
});
