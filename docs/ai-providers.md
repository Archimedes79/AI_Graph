# AI providers and configuration

Which model answers a graph, which one writes its code, and where the credentials live.

**AI-Graph is usable without paying anyone.** Run a local model, or use a hosted free
tier; add a paid provider only where you want the extra quality. The provider picker
says which is which, so the choice is visible rather than something to look up.

| Provider | Cost | Model | Credential |
|---|---|---|---|
| **Ollama** (default) | free, local | llama3, mistral, … | `OLLAMA_BASE_URL` (default: localhost) |
| LM Studio | free, local | any locally loaded model | `LMSTUDIO_BASE_URL` (default: `http://localhost:1234/v1`) |
| Google Gemini | free tier | gemini-flash-lite-latest (fast), gemini-flash-latest, … — prefer the `-latest` aliases: dated names are retired | `GOOGLE_API_KEY` — get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| GitHub Models | free tier | many | `GITHUB_TOKEN` with the `models:read` scope |
| OpenAI | paid | gpt-4o, … | `OPENAI_API_KEY` |
| Anthropic | paid | claude-sonnet-4-5, … | `ANTHROPIC_API_KEY` |
| OpenAI-compatible endpoint | depends | any compatible model | `OPENAI_COMPATIBLE_BASE_URL`, optional `OPENAI_COMPATIBLE_API_KEY` |

**Mixing free and paid is already how the graph works**, and is worth knowing: set the
graph's runtime default to a free provider, then pin the one node that needs more to a
paid one — an AI node left on *"Use the graph's default"* follows the free default, and
a node that names a provider keeps it. The code-generation AI is a separate setting
again, so you can author with a strong model and run on a free one.

Set environment variables in a `.env` file or pass them to Docker Compose.

## Choosing the AI once, not per node

Two separate settings, both behind **⚙ Settings** in the toolbar:

- **Code generation AI** – used by every ✨ Generate action. It belongs to your
  browser, not to the graph, so a graph you share carries no model choice of yours.
- **Runtime AI default** – what the graph's AI nodes call. Saved with the graph as
  `metadata.ai_defaults`; every AI node left on *"Use the graph's default"* follows
  it, so a graph with eight AI nodes is configured once.

## Where the API key goes

**⚙ Settings → Keys and addresses** takes the API key and the server address for every
provider, and shows which ones already have one. Keys are write-only: they are saved to
the settings file below and never read back into the browser. You can also write that
file by hand:

```json
{
  "codegen":  { "provider": "anthropic", "model": "claude-sonnet-4-5" },
  "ai":       { "provider": "lmstudio",  "model": "qwen2.5-coder-7b" },
  "api_keys": { "anthropic": "sk-ant-…", "openai": "", "github": "", "openai_compatible": "" },
  "endpoints": { "lmstudio_base_url": "http://localhost:1234/v1" }
}
```

`codegen` is the AI that answers ✨ Generate, `ai` the one the graph calls when it runs —
so you can generate with a strong hosted model and execute against a local one. The file is looked up in the working directory, next to the executable, at
`$AI_GRAPH_SETTINGS`, and finally `~/.ai-graph/settings.json`. An environment variable of
the same name always wins over what is stored there.

Two provider names are worth spelling out:

- **Anthropic** needs an API key from [console.anthropic.com](https://console.anthropic.com)
  (`ANTHROPIC_API_KEY`, or `api_keys.anthropic`). A locally installed Claude Desktop or
  Claude Code is *not* an endpoint this can call — those are applications, not an API
  server on your machine, so there is nothing to point a base URL at.
- **GitHub Copilot** in the provider list means the [GitHub Models](https://models.github.ai)
  API, which is OpenAI-compatible. It authenticates with a GitHub personal access token
  (`GITHUB_TOKEN`, or `api_keys.github`) that has the `models:read` scope — not with a
  Copilot editor subscription, which exposes no API of its own.

Anything else that speaks the OpenAI protocol — a proxy, a gateway, a self-hosted
server — goes in as **OpenAI-compatible endpoint** with its own base URL and key.

A deployed graph can be re-pointed at a different runtime AI without editing it, highest
precedence first: `--ai-provider`/`--ai-model` (CLI or the deployed GUI's settings
panel) → `AI_GRAPH_AI_PROVIDER`/`AI_GRAPH_AI_MODEL` → an `ai-settings.json` next to the
executable (also holds endpoints/API keys, so a double-clicked tool needs no
environment variables at all) → the graph's own `metadata.ai_defaults` → `ollama`/`llama3`.
`--ai-force` overrides even nodes that pin their own provider.

## Local models: LM Studio and Ollama

Start LM Studio's server (`lms server start`, or the *Developer* tab) and load a model;
AI-Graph finds it at `http://localhost:1234/v1` with no key. Name the model as LM Studio
lists it — `google/gemma-4-26b-a4b-qat` — on the node or as the graph's default.

**Models that think before they answer** (most recent local ones) spend the same token
budget on the thinking. On a laptop that is slow — minutes rather than seconds — and if
the budget runs out mid-thought the answer is empty. AI-Graph says so once instead of
retrying; the fixes are to raise `AI_GRAPH_MAX_TOKENS` (default 4096), to switch thinking
off where the model is served, or to use a model that does not think. For ✨ Generate a
non-thinking coder model is the better choice.

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
