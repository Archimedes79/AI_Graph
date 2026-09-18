<!-- last verified: 2026-09-19 -->
# AI-Graph — overview

Two processes: **Node** runs graphs, **the browser** draws them. They talk over HTTP,
and the conversation is one table both ends import: the contract. Detail diagrams:
[server](engine-host.md) · [browser](editor.md) · [elements](elements.md).

```mermaid
flowchart LR
  subgraph browser["editor/src — the browser"]
    EditorPage["Editor page"]
    ToolPage["Deployed tool page"]
    Client["API client"]
  end

  subgraph engine["engine/src — Node"]
    subgraph host["host/"]
      Contract["Contract"]
      Server["Server"]
      EditorRoutes["Editor routes"]
      Services["Runtime services"]
    end
    CLI["CLI"]
    Executor["Executor"]
    Elements["Elements + registry"]
    Graph["Graph document"]
    AI["AI providers + MCP"]
  end

  EditorPage --> Client
  ToolPage --> Client
  Client --> Contract
  Client -. "HTTP / JSON" .-> Server
  Server --> Contract
  Server -. "loaded only for the editor" .-> EditorRoutes
  EditorRoutes --> Contract
  Server --> Executor
  EditorRoutes --> Executor
  CLI --> Server
  CLI --> Executor
  Executor --> Elements
  Executor --> Graph
  Server --> Services
  Services --> AI
  EditorPage --> Elements
  EditorPage --> Graph
```

| Diagram node | Path | Notes |
|---|---|---|
| `Editor page` | [`editor/src/App.tsx`](../editor/src/App.tsx), [`editor/src/components/`](../editor/src/components/), [`editor/src/store/`](../editor/src/store/) | canvas, node editor, page designer; entry `editor/src/main.tsx` |
| `Deployed tool page` | [`editor/src/runtime/`](../editor/src/runtime/) | entry `runtime/main.tsx` → `runtime.html`; may not reach editor-only modules (`runtime/boundary.test.ts`) |
| `API client` | [`editor/src/utils/api.ts`](../editor/src/utils/api.ts) | `call(route, request)`; `ApiError`; `EditorView` narrows returned graphs |
| `Contract` | [`engine/src/host/api.ts`](../engine/src/host/api.ts) | every route: method, path, `tool`/`editor`, request and response types |
| `Server` | [`engine/src/host/serve.ts`](../engine/src/host/serve.ts), [`http.ts`](../engine/src/host/http.ts), [`runs.ts`](../engine/src/host/runs.ts), [`schedule.ts`](../engine/src/host/schedule.ts) | serves the page and the `tool` routes; refuses to start if a route has no handler |
| `Editor routes` | [`engine/src/host/editor/routes.ts`](../engine/src/host/editor/routes.ts) | the `editor` routes; dynamic import, never in a bundle |
| `Runtime services` | [`engine/src/host/node.ts`](../engine/src/host/node.ts) | files, sandboxed code, models, tools: the `Runtime` handed to elements |
| `CLI` | [`engine/src/main.ts`](../engine/src/main.ts), [`engine/src/cli.ts`](../engine/src/cli.ts) | run once / on a clock / `--serve` / `--bundle` / `--mcp` / `--editor` |
| `Executor` | [`engine/src/executor.ts`](../engine/src/executor.ts), [`triggers.ts`](../engine/src/triggers.ts), [`batching.ts`](../engine/src/batching.ts) | order, fan-out, memory, displays, stopping |
| `Elements + registry` | [`engine/src/element.ts`](../engine/src/element.ts), [`engine/src/elements/`](../engine/src/elements/), [`engine/src/registry.ts`](../engine/src/registry.ts) | one class per node type and block kind; see [elements](elements.md) |
| `Graph document` | [`engine/src/graph.ts`](../engine/src/graph.ts), [`editor/src/types/graphModel.ts`](../editor/src/types/graphModel.ts) | the engine's types; the editor adds only the typed `NodeConfig` view |
| `AI providers + MCP` | [`engine/src/ai/`](../engine/src/ai/) | providers, `ai-settings.json`, MCP client |

The page also runs engine code directly — elements for ports and previews, the graph
types — which is why `Editor page` has arrows into `Elements` and `Graph` without HTTP.
The bundle a deployed tool ships is `engine/src` minus every `editor/` folder, plus the
built `runtime.html` ([`engine/src/bundle.ts`](../engine/src/bundle.ts)).
