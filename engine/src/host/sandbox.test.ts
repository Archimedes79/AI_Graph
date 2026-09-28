import { describe, it, expect } from 'vitest';
import { nodeCode } from './node.ts';

/**
 * What a body may do.
 *
 * A body is often generated, and the sweep runs it to check it before anyone
 * has read it. So the policy is worth asserting rather than assuming: files
 * open, because reading and writing them is the job; starting other programs
 * closed, because no body has a reason to.
 *
 * The network is deliberately absent from these tests: Node has no flag for
 * it, so there is nothing here to assert and nothing to protect. See
 * `SANDBOX` in `node.ts`.
 */

describe('a code body', () => {
  it('may still read and write files', async () => {
    const body = `
      import { writeFileSync, readFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { tmpdir } from 'node:os';
      export function run() {
        const path = join(tmpdir(), 'ai-graph-sandbox-probe.txt');
        writeFileSync(path, 'written');
        return { value: readFileSync(path, 'utf8') };
      }
    `;
    expect(await nodeCode.run(body, {})).toEqual({ value: 'written' });
  });

  it('may not start another program', async () => {
    const body = `
      export function run() {
        const { execSync } = require('node:child_process');
        execSync('echo x');
        return { value: 'ran' };
      }
    `;
    await expect(nodeCode.run(body, {})).rejects.toThrow(/ERR_ACCESS_DENIED|not allowed|ERR_REQUIRE|Error/);
  });

  it('is handed no key of the process that runs it: it asks through node.llm', async () => {
    // Fake values, set for this test only: what matters is which names arrive.
    const planted = { OPENAI_API_KEY: 'sk-planted', GITHUB_TOKEN: 'ghp-planted', SERVICE_PASSWORD: 'planted', AI_GRAPH_PLAIN: 'kept' };
    Object.assign(process.env, planted);
    try {
      const body = `export function run() { return { names: Object.keys(process.env).filter((name) => ${JSON.stringify(Object.keys(planted))}.includes(name)) }; }`;
      expect(await nodeCode.run(body, {})).toEqual({ names: ['AI_GRAPH_PLAIN'] });
    } finally {
      for (const name of Object.keys(planted)) delete process.env[name];
    }
  });
});

describe('how a body may be written', () => {
  /**
   * Both styles come out of a model, and both are ordinary JavaScript. A body
   * using `require` used to fail with ERR_AMBIGUOUS_MODULE_SYNTAX -- a message
   * about module formats, for someone who only asked for a file to be read.
   */
  it('may use require', async () => {
    const body = `
      export function run() {
        const { tmpdir } = require('node:os');
        return { value: typeof tmpdir() };
      }
    `;
    expect(await nodeCode.run(body, {})).toEqual({ value: 'string' });
  });

  it('may export its run the CommonJS way, as code.js run on its own does', async () => {
    // A model that has just read input.js and output.js ends code.js the same way.
    const body = `
      function run(inputs) { return { words: inputs.text.split(' ').length }; }
      module.exports = { run };
      exports.also = run;
    `;
    expect(await nodeCode.run(body, { text: 'a b c' })).toEqual({ words: 3 });
  });

  it('may use import', async () => {
    const body = `
      import { tmpdir } from 'node:os';
      export function run() { return { value: typeof tmpdir() }; }
    `;
    expect(await nodeCode.run(body, {})).toEqual({ value: 'string' });
  });
});
