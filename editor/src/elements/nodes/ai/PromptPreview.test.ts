import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { withPerItem } from '@/authoring/nodeStepRules';
import { previewIsLocal } from './PromptPreview';

/**
 * "What the model receives" is put together in the page only where a run
 * sends exactly that; everywhere else the engine shows each request a run
 * would send. It used to be put together in the page always, under the words
 * "exactly what the model will receive".
 */
describe('what the model receives, for the example', () => {
  const node = () => NODE_KINDS.ai.create('summarize');

  it('is put together here when a run sends just that', () => {
    expect(previewIsLocal(node(), { prompt: 'Once upon a time.' }, [])).toBe(true);
    // A list, to a node that takes lists whole, is one request too.
    expect(previewIsLocal(withPerItem(node(), false), { prompt: ['a', 'b'] }, [])).toBe(true);
  });

  it('is asked of the engine when a list is asked about one item at a time', () => {
    // It showed one message with every story joined; a run asks once per story.
    expect(previewIsLocal(node(), { prompt: ['first', 'second'] }, [])).toBe(false);
  });

  it('is asked of the engine when a port is handed a file\'s text, not its path', () => {
    // It showed the path as the message; a run sends what the file says.
    expect(previewIsLocal(node(), { prompt: 'stories/a.txt' }, ['prompt'])).toBe(false);
  });

  it('is asked of the engine when pictures are split off, or a run.js of the person\'s own asks', () => {
    const images = node();
    images.config.send_images = true;
    expect(previewIsLocal(images, { prompt: 'look' }, [])).toBe(false);
    const own = node();
    own.config.run_code = 'async function run(inputs, node) { return { output: await node.llm({ prompt: "x" }) }; }';
    expect(previewIsLocal(own, { prompt: 'x' }, [])).toBe(false);
  });
});
