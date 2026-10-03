# AI providers and configuration

Which model answers a graph and writes its code, and where the credentials live.

**AI-Graph is usable without paying anyone.** Run a local model, or use a hosted free
tier; add a paid provider only where you want the extra quality. The provider picker
says which is which, so the choice is visible rather than something to look up.

| Provider (id) | Cost | Model when none is named | Credential |
|---|---|---|---|
| **Ollama** (`ollama`) | free, local | the first model it serves, else `llama3` | `OLLAMA_BASE_URL` (default `http://localhost:11434`) |
| LM Studio (`lmstudio`) | free, local | the first model it serves | `LMSTUDIO_BASE_URL` (default `http://localhost:1234/v1`) |
| Google Gemini (`google`) | free tier | `gemini-flash-lite-latest` -- prefer the `-latest` aliases: dated names are retired | `GOOGLE_API_KEY` -- get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| GitHub Models (`github_copilot`) | free tier | `gpt-4o-mini` | `GITHUB_TOKEN` with the `models:read` scope |
| OpenAI (`openai`) | paid | `gpt-4o-mini` | `OPENAI_API_KEY` |
| Anthropic (`anthropic`) | paid | `claude-opus-5` | `ANTHROPIC_API_KEY` |
| OpenAI-compatible endpoint (`openai_compatible`) | depends | none: name one | `OPENAI_COMPATIBLE_BASE_URL`, optional `OPENAI_COMPATIBLE_API_KEY` |

The ids are what `AI_GRAPH_AI_PROVIDER` and the settings file take. The defaults are
`DEFAULT_MODELS` in `engine/src/ai/settings.ts` and `DEFAULT_SETTINGS` in
`engine/src/ai/providers.ts`. Google's and GitHub Models' addresses can also be moved with
`GOOGLE_BASE_URL` and `GITHUB_MODELS_BASE_URL`; an `endpoints` entry in the settings file
does the same for any provider.

**Mixing free and paid is already how the graph works**, and is worth knowing: set the
one AI setting to a free provider, then pin the one node that needs more to a paid one —
an AI node left on *"Use the setting in ⚙ Settings"* follows the free one, and a node
that names a provider and model keeps them.

Environment variables are read as the process has them. `docker-compose.yml` passes on the ones it lists -- `OLLAMA_BASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY` -- from the shell or a `.env` beside it.

## Choosing the AI once, not per node

There are exactly two levels:

1. **The one AI setting** — **⚙ Settings → AI** in the toolbar. ✨ (and the try and
   repair it runs on what it wrote, "Say what to change" and ✨ Fix), ▶ Try, `test`,
   and every run
   call it, for every AI call a node does not pin: an AI node
   left on its default, and code that asks a model through `node.llm`. It belongs to
   this machine and is saved in `ai-settings.json` (below), never in a graph — so a
   graph you share runs on whatever its recipient chose.
2. **A node's own model** — an AI node's *Model for this node* either says *"Use the
   setting in ⚙ Settings (now: provider / model)"*, which every new node does, or
   names a provider and model, which always win.

The dialog, the node's picker and the terminal the editor was started from all show
what the setting resolves to *now*, as the engine answers it — the same function a
run asks.

## Where the API key goes

**⚙ Settings → Keys and addresses** takes the API key and the server address for every
provider, and shows which ones already have one. Keys are write-only: they are saved to
the settings file (below) and never read back into the browser. You can also write that
file by hand:

```json
{
  "ai":       { "provider": "lmstudio",  "model": "qwen2.5-coder-7b" },
  "api_keys": { "anthropic": "sk-ant-…", "openai": "", "github_copilot": "", "openai_compatible": "" },
  "endpoints": { "lmstudio": "http://localhost:1234/v1" }
}
```

`ai` is the one AI setting. A provider without a model takes that provider's own
default (the table); with no `ai` at all it is whichever local provider is running, else
Ollama. `ai-settings.example.json` beside the README shows the shape.

**Which file.** The first of these that exists: `ai-settings.json` in the working directory,
in the folder that holds `engine/` (the checkout, the download, a bundle -- beside its
`run.sh`), and `~/.ai-graph/settings.json`; where none does, a save creates the first. When
`AI_GRAPH_SETTINGS` is set, that one file is the only one, even before it exists
(`engine/src/ai/settings.test.ts`; `cli/bundle.test.ts`: "looks for its AI settings beside
run.sh"). The file is never committed (`.gitignore`) and is never opened by an MCP tool.

**Which wins.** An environment variable of the same name wins over the file: `AI_GRAPH_AI_PROVIDER`
and `AI_GRAPH_AI_MODEL` each on its own (one naming only the model leaves the file's provider
standing), and every key and address variable in the table.

Two provider names are worth spelling out:

- **Anthropic** needs an API key from [console.anthropic.com](https://console.anthropic.com)
  (`ANTHROPIC_API_KEY`, or `api_keys.anthropic`). A locally installed Claude Desktop or
  Claude Code is *not* an endpoint this can call — those are applications, not an API
  server on your machine, so there is nothing to point a base URL at. Current Claude
  models accept no temperature: leave a node's temperature unset for them (below).
- **GitHub Copilot** in the provider list means the [GitHub Models](https://models.github.ai)
  API, which is OpenAI-compatible. It authenticates with a GitHub personal access token
  (`GITHUB_TOKEN`, or `api_keys.github_copilot`) that has the `models:read` scope — not with a
  Copilot editor subscription, which exposes no API of its own.

Anything else that speaks the OpenAI protocol — a proxy, a gateway, a self-hosted
server — goes in as **OpenAI-compatible endpoint** with its own base URL and key.

On a machine without the editor -- a deployed tool, a server, a CI job -- the same setting
is set without the dialog: the two variables, or the `ai` section of the file, which also
holds endpoints and keys, so a double-clicked tool needs no environment variables at all. The
command line has no flag for it: a variable set on one command does the same job. The
deployed page's **⚙ AI settings** shows what the setting resolves to -- what a run of the
tool calls -- and where the file goes; it does not write one, because a page that stored
credentials would put a key in a file nobody asked for.

## Local models: LM Studio and Ollama

Start LM Studio's server (`lms server start`, or the *Developer* tab) and load a model;
AI-Graph finds it at `http://localhost:1234/v1` with no key. Name the model as LM Studio
lists it — `google/gemma-4-26b-a4b-qat` — in ⚙ Settings or on the node.

**A body that asks a model.** A code node asks through `node.llm` — the call is made
for it, by the process that holds the keys. One run of a
body may ask 25 times, so a loop that forgot to end costs a finite amount;
`AI_GRAPH_MAX_LLM_CALLS` raises or lowers that where the tool runs.

**Models that think before they answer** (most recent local ones) spend the same token
budget on the thinking. On a laptop that is slow — minutes rather than seconds — and if
the budget runs out mid-thought the answer is empty. AI-Graph says so once instead of
retrying; the fixes are to raise `AI_GRAPH_MAX_TOKENS` (default 4096), to switch thinking
off where the model is served, or to use a model that does not think. For ✨ a
non-thinking coder model is the better choice. The same holds for a Claude model that
thinks, whose answer is cut off by the token budget before its first word.

**Temperature** is sent only when an AI node sets one; otherwise every provider answers
at its own default, and ✨ sets none either.

## Tools: connecting a prompt to an MCP server

An AI node can be given tools from [MCP](https://modelcontextprotocol.io) servers. Open
the node, unfold **Advanced**, and list the servers under *Tools the model may use*, one
per line. While answering, the model calls the tools it needs; what it says afterwards is
the node's output. It works with every provider that supports tool calling — OpenAI-style
endpoints (OpenAI, Gemini, LM Studio, …), Anthropic and Ollama.

A line is one of two things:

| What you write | What it means |
|---|---|
| `https://example.com/mcp` | A server reached over HTTP (Streamable HTTP). Called directly — the same class of thing as calling a model. |
| `filesystem` | A **name**, looked up in this machine's `ai-settings.json`. |

Names are how a graph gets a tool that runs as a local program:

```json
{
  "mcp_servers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/data"] },
    "internal":   { "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}
```

**A graph can name a tool server but never the command that starts one.** That is the
security boundary: a graph someone hands you may ask for `filesystem`, and it gets whatever
*you* configured under that name — or a clear error saying the name is not configured here.
It cannot make your machine start a program of its choosing. Headers, and with them
credentials, likewise live only in the settings file.

Servers are opened when the node runs and closed when it has answered, so a finished run
leaves nothing running. The model gets at most eight rounds of tool calls per answer.

**Clocks.** A tool call is given two minutes, which is about a wedged server rather than a
slow one: a scheduled run has nobody watching it. A tool that genuinely takes longer — a
crawl, a build — gets more with `AI_GRAPH_MCP_TIMEOUT_MS`, and `0` takes the clock off
entirely. Stop ends a call either way, so nothing waits forever for a run that was
abandoned. A model call is given ten minutes -- generous, since a local model asked for a
whole graph is slow, and a hosted one that hangs otherwise holds a node's ✨ for as long as
its connection lives. One that runs past it is given up, not asked again, and says so:
"The model did not answer within 10 minutes". `AI_GRAPH_TIMEOUT_MS` sets another clock, in
milliseconds, and `0` takes it off.
