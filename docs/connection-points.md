# Connection points

Where something else meets AI-Graph: another page, a script, a model over MCP, a body
in a process of its own. There are four. Each section says what crosses the point, which code holds it,
and which test holds each claim. How AI-Graph works inside is
[architecture.md](architecture.md).

```
                  design                                    in use
  the editor ──▶ ① the folder ──▶ the engine ◀── ③ the runtime API ◀── a page, a script
  a person                           │   ▲            (HTTP, JSON)
                                     │   └── ② the graph's names: what ③, the CLI and MCP speak
                                     ▼
                          ④ a body, in a process of its own
```

| | What crosses it | Who is on the other side | Held by |
|---|---|---|---|
| ① The folder | the design, at rest | the editor, the CLI, MCP, a text editor | `project/folder.test.ts`, `project/interfaceFile.test.ts`, `examples.test.ts` |
| ② The graph's names | what a graph offers: events, values, outputs | every caller | `execution/graphInterface.test.ts` |
| ③ The runtime API | a graph in use: rounds, the session, the stream | a page in a browser, a script | `host/runtimeApi.test.ts`, `host/frontend.test.ts`, `host/serve.test.ts` |
| ④ The body protocol | one call of a node's code | a body in a process of its own | `host/node.test.ts`, `host/sandbox.test.ts` |

Test paths are under `engine/src/` unless they say otherwise.

## The folder

A graph is a folder of JSON and plain text: nothing in it needs the engine to be read.
Each fact is in one place ([A graph on disk](architecture.md#a-graph-on-disk) has the
whole of it):

```
flow.json                 the graph's name and description, which nodes there are (id → type),
                          and every wire, one line each: "page.chat_out -> assistant.message"
nodes/<id>/node.json      the node's heading, text and settings -- only what differs from the default
nodes/<id>/interface.json its ports: { "port", "name", "type", "required"? }, inputs and outputs
nodes/<id>/input.js …     each piece of writing in a file of its own: input.js, output.js,
                          code.js, prompt.md, data.json or data.txt, history.md
page/                     the page node's folder: page.json holds its blocks, in order
layout.json               positions only
frontend/                 a page of the project's own (③)
```

- `flow.json` says the flow and nothing about any node, and a node's folder nothing
  about its neighbours (`project/folder.test.ts`: "says the flow once, in flow.json, and
  nothing about any node there", "keeps a node's settings in its node.json and its ports
  in its interface.json"; `project/interfaceFile.test.ts`: "says what goes in and what
  comes out -- nothing about its neighbours").
- Which setting is which file is the element's to say (`NodeRunner.texts`), and every file
  is there from the start (`project/folder.test.ts`: "keeps each piece of writing in a
  file named for what it is", "writes every file a node has from the start").
- Read and written back, a folder is the same bytes (`project/folder.test.ts`: "reads back
  exactly what was written", "writes the same bytes for the same graph, so an unchanged
  save is no change").
- What a folder gets wrong is one list, `check` (`project/check.ts`,
  `project/folderCheck.ts`), for the CLI, the MCP server and the editor alike.
- `state.json` beside it is not the project's: what using the graph left behind
  (`host/session.test.ts`: "is not the project's: a save and a check leave state.json
  alone, and a bundle never carries it").
- The examples are folders the tests read, run and deploy (`examples.test.ts`), and each
  one can be built by hand in the editor (`editor/src/masterExamples.test.ts`).

## The graph's names

What a graph offers whoever uses it from outside, by name -- never by node or port
(`execution/graphInterface.ts`; each element says what it offers, `NodeRunner.offers`):

- **events** start a round, **values** are what a round is given, **outputs** are what it
  hands back. A block on the page is named by its id; an input, output or trigger node by
  its own. A heading or a divider offers nothing: it is the design
  (`execution/graphInterface.test.ts`: "names a block by its id and a node by its own, in
  three kinds, with no node or port in sight", "offers a heading and a divider nothing").
- An event names what starts the round -- a block, a trigger node -- and a round given
  none runs the whole graph ("starts the round an event names -- none is the whole graph
  -- and refuses one it does not offer").
- A value goes where its node keeps it (`NodeRunner.setValue`); a chat takes a message as
  the one in hand. Values with one name the graph does not take are refused, all of them,
  before anything runs ("values by name").
- An output is what a round shows: a block's display as drawn, an output node's value as
  wired in ("outputs by name").
- A name two nodes offer is a problem `check` names: a caller only ever reaches the first
  ("a name two nodes offer").

The same names are spoken everywhere a graph is used: the runtime API (③); the command
line, `--event go --value name=…` (`cli/cli.test.ts`: "a round by name, as a page asks for
one"); the MCP server's `run_graph` and `describe_graph` (`host/editor/mcpServer.test.ts`:
"takes values by the names the graph offers, and refuses one it does not take"); and the
questions a round asks before it runs, each answered under a value's name
(`host/session.test.ts`: "what a round asks before it runs"). A graph inside a node meets
the graph above it the same way, through its input and output nodes
(`elements/nodes/subgraph/boundary.ts`).

## The runtime API

A graph in use, over HTTP and JSON: the `tool` rows of the one route table,
[`host/api.ts`](../engine/src/host/api.ts). Every server answers them -- the editor and a
deployed tool alike -- and a deployed tool answers nothing else (`host/serve.test.ts`:
"serves a deployed tool its own routes of the contract, and none of the editor's").

| Route | What it is for |
|---|---|
| `GET /api/runtime/interface` | The names (②), the graph's name and description, and the session's id |
| `GET /api/runtime/page` | The page as it was designed -- name, description, colour scheme, blocks -- whether opening it runs the graph whole once (`starts_whole`), and which design it is (`design_revision`) |
| `GET /api/runtime/session` | What using the graph left: each value, each output, how many rounds ran, the round going or last, the clock -- and which design the server holds (`design_revision`), so a page drawn from it is drawn again when it changes |
| `GET /api/runtime/stream` | Server-sent events: `session` on connect and after every change, `round` as each round starts, goes and ends |
| `POST /api/runtime/requirements` | `{ event, values }`: what that round would still ask before it runs -- a file nobody chose, a place to write -- each under the value name that answers it |
| `POST /api/runtime/rounds` | `{ event, values }`: start a round, answered at once with its id; watch it on the stream or at `GET /api/runtime/rounds/:id` |
| `POST /api/runtime/rounds/:id/stop` | Stop it, whoever started it |
| `POST /api/runtime/run` | The same round as a function call, answered once it ended: `{ status, error, outputs, values }` |
| `POST /api/runtime/reset` | Forget what using the graph left behind: it is as designed again |
| `GET /api/runtime/ai-settings` | Which model a run calls, read-only |
| `POST /api/files/browse` | A file picker's listing, for the person at the keyboard: loopback only |

- A graph is a function with memory: a round goes in with an event and values, outputs
  come out, and what it leaves is the session's, kept in `state.json` -- written only when
  a round ran to its end ([State](architecture.md#state); `host/runtimeApi.test.ts`: "runs
  a round by event and values and answers once it ended: a function call", "forgets on
  reset what using the graph left behind").
- Every route that asks about the session takes its id -- the server's own when left out
  -- and turns another down with 404 and the advice to ask for the interface again
  ("answers for its own session only"). A name the graph does not offer is 400, saying
  which it does ("turns down a name the graph does not offer, saying which it does"). A
  graph that could not run -- a cycle, say -- is 422 from `run`; a round started by
  `rounds` says so in its own record, as `error` ("says a graph that could not run as one").
  A refusal is `{ "detail": "…" }`.
- The stream tells every round, whoever started it: this page, another tab, the clock
  ("streams the session on connect, then each round as it starts and ends, whoever started
  it").
- A request's body is JSON, sent as `application/json`, from the server's own origin, to a
  loopback name unless the server was bound wider (`foreignRequest` in `host/http.ts`;
  `host/serve.test.ts`: "a web page elsewhere in the same browser").
- One session per server; its id travels in every route ([State](architecture.md#state)).
- A project's `frontend/index.html` is served at `/` in place of the built page, and a
  bundle carries it. The example one calls nothing else (`host/frontend.test.ts`: "in the
  example, calls nothing but the runtime API any frontend may call", "runs the example by
  name: the paragraph in, the report out"). The built-in page is a frontend like any
  other: it holds no graph (`editor/src/runtime/boundary.test.ts`: "reaches nothing in
  store/"), and the browser draws a block from the page as designed (`GET /api/runtime/page`).

## The body protocol

How a node's code is run: `elements/body.ts` (`runBody`) decides when, `host/node.ts`
(`nodeCode`) how.

- A body is `code.js`: `async function run(inputs, node)`, returning an object keyed by
  output port (`host/node.test.ts`: "returns what the body returned";
  `elements/body.test.ts`).
- It runs in a process of its own under Node's permission model: files yes; other
  programs, native addons and workers no. The network is not closed: Node has no flag for
  it (`host/sandbox.test.ts`: "may still read and write files", "may not start another
  program").
- No key reaches it: its environment holds no credential, and a model is asked through
  `node.llm`, answered by the process that holds the graph ("is handed no key of the
  process that runs it: it asks through node.llm").
- What travels are lines of JSON, with nothing JavaScript about them
  (`host/node.test.ts`: "a body that asks the process holding the graph", "a body that
  does not keep to the protocol"):

  ```
  stdin   {"inputs": {…}, "calls": ["llm", …]}                       one line: what it is handed
  stdout  ␞ai-graph:call {"id": 1, "name": "llm", "args": …}          a question, on a line of its own
  stdin   {"id": 1, "result": …}   or   {"id": 1, "error": "…"}       its answer
  stdout  ␞ai-graph:result {…}                                        what it made; the run is over
  ```

  `␞` is U+001E. Anything else a body prints is its own ("may print what it likes: only
  the marked line is its result"); a body that ends without the result line has failed,
  and its error is counted in its own lines ("the sandbox").
- What one call is handed and returns is written down beside the body, each with an
  example: `input.js` and `output.js`. Every run is held to `output.js`
  (`execution/interface.test.ts`: "a run held to its output.js").
