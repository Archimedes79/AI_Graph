# The MCP server

Lets an assistant outside AI-Graph — Claude Code, Claude Desktop, any
[Model Context Protocol](https://modelcontextprotocol.io) client — design a graph,
check it, save it and run it, without the editor being open.

Two ways to get a graph out of it, and the difference matters:

- **The assistant writes it.** It reads `authoring_guide`, writes the JSON itself,
  and hands it to `validate_graph` and `save_graph`. Needs no model on this machine,
  and a strong assistant usually writes a better graph than a small local model.
- **This machine's model writes it.** `generate_graph` asks the *code generation AI*
  from ⚙ Settings (see [ai-providers.md](ai-providers.md)) — the same call the
  editor's "generate a graph" makes.

It is one process on stdio, started by the client, with no port and no dependencies.
(Not to be confused with `mcp_servers` in `ai-settings.json`: that is the other
direction, tools a *graph's* AI node may call.)

## Registering it

Claude Code:

```sh
claude mcp add ai-graph -- node <repo>/engine/src/main.ts --mcp --mcp-root <project folder>
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-graph": {
      "command": "node",
      "args": ["<repo>/engine/src/main.ts", "--mcp", "--mcp-root", "<project folder>"]
    }
  }
}
```

Use absolute paths for both. Node 24 or newer, as for the rest of the engine.
`--mcp-root` is the one folder the server may touch; without it, that is the folder
the client started the process in. A deploy bundle does not contain the server — it
is authoring, and ships with the editor only.

## The tools

| Tool | Arguments | What it does |
|---|---|---|
| `authoring_guide` | — | The authoring prompt the editor's own generation uses, plus the node types and block kinds this engine has. Read before writing a graph by hand. |
| `generate_graph` | `description`, `save_as?` | Has the configured generation model design a graph. Returns the graph, the explanation and any problems; with `save_as`, writes it if there are none. Says so plainly when no model is configured. |
| `validate_graph` | `graph` *or* `path` | Lists what is wrong, each with where and how to fix it. Empty list = valid. |
| `save_graph` | `path`, `graph` | Validates, then writes pretty JSON. Refuses a graph with problems and returns them. |
| `run_graph` | `path`, `inputs?`, `trigger?` | Runs once. Reports overall status, each node's status and error, and each node's outputs with every value cut to about 600 characters. |
| `list_graphs` | — | The graphs under the root: path, name, description, node count. Four folders deep, 200 at most. |

`validate_graph` finds the mistakes that are silent at run time: an unknown
`node_type` or block kind; duplicate node, edge or block ids; an edge to a node that
is not there, or to a port the node does not have — checked against the ports the
engine *derives* for `input` and `gui` nodes, not the ones the document claims, with
`__run` accepted everywhere; a cycle that does not pass through a node that
remembers; a code node with no `config.code`; and a graph with no `gui` and no
`output` node, which computes its answer and shows nobody.

`run_graph`'s `inputs` are keyed by node id, or `nodeId::blockId` for a block on a
page — the same keys as `--inputs` on the command line. `trigger` is
`{ "node_id": "<gui node>", "port_id": "<block id>_out" }` and runs only what that
button or box would start. A run calls the graph's models and runs its code for real.

## What it is confined to

The caller is a model acting on text it read somewhere, so every argument is treated
as if a stranger wrote it.

- **One folder.** Every path is resolved against the root and must stay inside it:
  `..`, an absolute path elsewhere and another drive are refused alike. Checked as
  written and again after following links, so a symlink or junction inside the root is
  not a way out.
- **Only `.json`,** and never under a dot-folder, `node_modules` or `dist`.
- **A file that exists is replaced only if it is already a graph.** `save_graph`
  cannot overwrite `package.json`: it has no `nodes`.
- **`ai-settings.json` is never opened** by any tool, under any spelling.
- **Nothing returned carries a key,** an environment variable or settings content. A
  provider's error message passes through — it is how you learn a model name is wrong —
  with anything matching a configured secret blanked first. The same filter runs over
  every result, a run's outputs included.
- **Sizes are bounded** both ways: a description up to 20,000 characters, a graph up
  to 2 MB, a run's values truncated.

**What it does not confine is a graph that runs.** `run_graph` executes code nodes in
the same sandbox as every other run (`host/node.ts`): no child processes, no native
addons, no worker threads — but files and the network stay open, because reading
files is what most graphs are for. The root fences in what the *tools* touch, not
what a graph's own code touches. So point `--mcp-root` at a project folder, not at
your home directory, and treat "run this graph" like "run this script".

The server moves into its root when it starts, so a relative path inside a graph —
`data/sales.csv` on an input node — is relative to the root too.

## A worked exchange

> **You:** Make me a graph that counts the rows in `data/sales.csv` and shows the number.

The assistant calls **`generate_graph`**:

```json
{ "description": "Read data/sales.csv, count its rows, and show the count in a window.",
  "save_as": "graphs/count_rows.json" }
```

```json
{ "model": "google / gemini-flash-latest",
  "saved": "graphs/count_rows.json",
  "problems": [],
  "explanation": "An input node reads the file, a code node counts lines, an output node shows the result.",
  "graph": { "metadata": { "name": "Count rows" }, "nodes": ["…"], "edges": ["…"] } }
```

Had the model wired the file's text from a port called `text`, nothing would have
been written, and `problems` would say so:

```json
{ "where": "edge \"e1\"",
  "problem": "Its source port \"text\" is not an output of node \"source\".",
  "fix": "The ports of an input node are derived from its settings, not from what the document declares. Its outputs are: \"content\", \"path\". Wire to one of those, or change the settings that produce them." }
```

The assistant fixes the edge, checks with **`validate_graph`** `{ "graph": { … } }` →
`{ "valid": true, "problems": [] }`, writes it with **`save_graph`**, and tries it
with **`run_graph`** `{ "path": "graphs/count_rows.json" }`:

```json
{ "status": "success",
  "nodes": [
    { "id": "source", "status": "success", "outputs": { "content": "date,region,amount\n2024-01-02,north,120… (+48211 characters)", "path": "…" } },
    { "id": "rows",   "status": "success", "outputs": { "rows": 1204 } },
    { "id": "shown",  "status": "success", "outputs": { "value": 1204 } } ],
  "outputs": { "Rows": { "value": 1204 } } }
```

With no generation model configured, `generate_graph` answers with that fact and the
way round it; the assistant calls **`authoring_guide`**, writes the same graph itself,
and the rest of the exchange is unchanged. Open `graphs/count_rows.json` in the editor
afterwards to see it, lay it out, or bundle it.
