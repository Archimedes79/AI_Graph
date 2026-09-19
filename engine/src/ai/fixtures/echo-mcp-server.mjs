// A tool server small enough to read in one go, for `mcp.test.ts`.
//
// Plain Node and no SDK, for the same reason the client has none: the test
// should fail because the client is wrong, not because a package moved. It
// also misbehaves on purpose, in the ways real servers do -- a banner on
// stdout, chatter on stderr, a tool list that comes in pages.
//
//   node echo-mcp-server.mjs            the server
//   node echo-mcp-server.mjs --crash    dies before saying hello, loudly
//   node echo-mcp-server.mjs --mute     reads everything and answers nothing

import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? '';

if (mode === '--crash') {
  process.stderr.write('echo-mcp-server: the database is on fire\n');
  process.exit(3);
}

// Not JSON, on the channel that is supposed to carry only JSON.
process.stdout.write('echo-mcp-server ready\n');
process.stderr.write('echo-mcp-server: listening on stdio\n');

const TOOLS = [
  {
    name: 'add',
    description: 'Add two numbers.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
  {
    name: 'echo',
    description: 'Say it back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'fail',
    description: 'Always fails, the polite way: a result that says it is an error.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'picture',
    description: 'Returns a caption and an image.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'whoami',
    description: 'Says what EXAMPLE_NAME is set to, so a test can see `env` arrive.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'hang',
    description: 'Never answers, the way a wedged server does: for the clock and for Stop.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    // Listed and then denied, which is how a JSON-RPC *error* -- as opposed to
    // a result flagged `isError` -- gets to a client that only calls listed tools.
    name: 'ghost.tool',
    description: 'Is in the list and not in the server.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const text = (value) => ({ content: [{ type: 'text', text: String(value) }] });

function call(name, args) {
  if (name === 'add') return text(Number(args.a) + Number(args.b));
  if (name === 'echo') return text(args.text);
  if (name === 'fail') return { ...text('it did not work'), isError: true };
  if (name === 'whoami') return text(process.env.EXAMPLE_NAME ?? 'nobody');
  if (name === 'picture') {
    return { content: [{ type: 'text', text: 'a cat' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] };
  }
  return undefined;
}

const lines = createInterface({ input: process.stdin });

lines.on('line', (line) => {
  if (mode === '--mute') return;
  const message = JSON.parse(line);
  const { id, method, params } = message;

  // Notifications get no answer; that is what makes them notifications.
  if (id === undefined) return;

  if (method === 'initialize') {
    send({
      id,
      result: {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'echo', version: '0.0.0' },
      },
    });
  } else if (method === 'tools/list') {
    // Two pages, so a client that forgets `nextCursor` is missing tools.
    if (!params?.cursor) send({ id, result: { tools: TOOLS.slice(0, 2), nextCursor: 'page-2' } });
    else send({ id, result: { tools: TOOLS.slice(2) } });
  } else if (method === 'tools/call') {
    // No answer, ever: what a client does about that is the point of it.
    if (params.name === 'hang') return;
    const result = call(params.name, params.arguments ?? {});
    if (result) send({ id, result });
    else send({ id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
  } else {
    send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});

// Closing stdin is how a client says goodbye.
lines.on('close', () => process.exit(0));
