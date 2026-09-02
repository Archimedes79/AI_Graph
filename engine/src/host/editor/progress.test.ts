import { describe, it, expect } from 'vitest';
import { generate, type AICall } from './generate.ts';
import { registry } from '../../registry.ts';
import type { AiService, CodeRunner } from '../../element.ts';

/**
 * A generation is several calls over a minute or more, and until it returns
 * there is nothing to look at. Handing the transcript array in lets the editor
 * read it while it fills -- the prompt, the context, each step -- which is
 * what turns the wait from a spinner into something a person can judge.
 */

const never: CodeRunner = { run: async () => ({}) };
const generationFor = (name: string) => registry.node(name)?.generation() ?? registry.widget(name)?.generation();
const target = { provider: 'p', model: 'm' };

/** A model that answers slowly, so the transcript can be read mid-flight. */
function slow(replies: string[], delayMs: number): AiService {
  let next = 0;
  return {
    complete: async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return replies[Math.min(next++, replies.length - 1)];
    },
  };
}

describe('watching a generation while it runs', () => {
  it('fills the array that was handed in, before it returns', async () => {
    const calls: AICall[] = [];
    const running = generate(
      { element: 'ai', description: 'be brief' },
      { ai: slow(['written'], 120), code: never, generationFor, target, calls },
    );

    // Mid-flight: the call is recorded with its prompt, and no reply yet.
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('be brief');
    expect(calls[0].reply).toBeNull();

    await running;
    expect(calls[0].reply).toBe('written');
    expect(calls[0].seconds).toBeGreaterThan(0);
  });

  it('is the same array the reply carries, so nothing is counted twice', async () => {
    const calls: AICall[] = [];
    const reply = await generate(
      { element: 'ai', description: 'x' },
      { ai: slow(['ok'], 1), code: never, generationFor, target, calls },
    );
    expect(reply.calls).toBe(calls);
  });
});
