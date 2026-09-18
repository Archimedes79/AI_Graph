<!-- last verified: 2026-09-19 -->
# Elements — engine/src/elements ⇄ editor/src/elements

What a node or a widget *is*, and how it looks and is edited. One folder per element, at the
same relative path on both sides: the engine half says what it is and does, the editor half
how it looks (`View`), how it is edited (`Panel`) and what the shells ask of it (`.ui.ts`).
[`symmetry.test.ts`](../editor/src/elements/symmetry.test.ts) keeps the two sides in step.
Back to the [overview](overview.md).

```mermaid
flowchart LR
  subgraph engine["engine/src/elements — what it is and does"]
    Base["Element"]
    NodeBase["GraphNodeElement"]
    WidgetBase["WidgetElement"]
    Nodes["nodes/<kind>/<Kind>Node"]
    Widgets["widgets/<kind>/<Kind>Widget"]
    Registry["registry + roster"]
    Runtime["Runtime"]
  end
  subgraph editor["editor/src/elements — how it looks and is edited"]
    Contract["ElementUi"]
    NodeUis["nodes/<kind>/<Kind>Node.ui + Panel"]
    WidgetUis["widgets/<kind>/<Kind>Widget.ui + View + Panel"]
    UiRegistry["registry"]
  end

  NodeBase -- extends --> Base
  WidgetBase -- extends --> Base
  Nodes -- extend --> NodeBase
  Widgets -- extend --> WidgetBase
  Base --> Runtime
  Registry --> Nodes
  Registry --> Widgets
  NodeUis --> Contract
  WidgetUis --> Contract
  UiRegistry --> NodeUis
  UiRegistry --> WidgetUis
  NodeUis -. "generation()" .-> Nodes
  WidgetUis -. "generation()" .-> Widgets
  UiRegistry -. "same kinds" .-> Registry
```

| Diagram node | Path | Notes |
|---|---|---|
| `Element` | [`engine/src/elements/Element.ts`](../engine/src/elements/Element.ts) | `config()`, `logic()`, `generation()`, `catchesErrors()`, `deployNeeds()`, `runSnippet()` |
| `GraphNodeElement` | [`engine/src/elements/GraphNodeElement.ts`](../engine/src/elements/GraphNodeElement.ts) | a node: `derivedPorts`, `execute`, `display`, `runtimeRequirements`, `settleMemory`, and what the executor reads (`batchMode`, `readsFileInputs`, …) |
| `WidgetElement` | [`engine/src/elements/WidgetElement.ts`](../engine/src/elements/WidgetElement.ts) | a widget on a page: `ports`, `execute`, `firesRun`, `settle`, `displayValue`; `Widget`, `WidgetPresentation` |
| `nodes/<kind>/<Kind>Node` | [`engine/src/elements/nodes/`](../engine/src/elements/nodes/) | `InputNode`, `AiNode` (+ `prompt.ts`), `CodeNode`, `DataNode`, `OutputNode`, `GuiNode` (a composite of widgets; `parseWidget`) |
| `widgets/<kind>/<Kind>Widget` | [`engine/src/elements/widgets/`](../engine/src/elements/widgets/) | 12 kinds; bases [`StaticWidget`](../engine/src/elements/widgets/StaticWidget.ts), [`DisplayWidget`](../engine/src/elements/widgets/DisplayWidget.ts), [`TransformingDisplay`](../engine/src/elements/widgets/TransformingDisplay.ts); chart check in [`plot_window/check.ts`](../engine/src/elements/widgets/plot_window/check.ts) |
| `registry + roster` | [`engine/src/elements/registry.ts`](../engine/src/elements/registry.ts), [`widgets/roster.ts`](../engine/src/elements/widgets/roster.ts) | node type / widget kind → element; one line each to add a kind |
| `Runtime` | [`engine/src/elements/Runtime.ts`](../engine/src/elements/Runtime.ts) | the services an element is handed: `files`, `code`, `ai`, `tools`; implemented for Node in [`host/node.ts`](../engine/src/host/node.ts) |
| `ElementUi` | [`editor/src/elements/ElementUi.ts`](../editor/src/elements/ElementUi.ts) | `NodeUi`, `WidgetUi`, and the props every panel is handed (`NodePanelProps`, `WidgetPanelProps`) |
| `nodes/<kind>/<Kind>Node.ui + Panel` | [`editor/src/elements/nodes/`](../editor/src/elements/nodes/) | `AiNode.ui.ts`, `AiNodePanel.tsx`, `AiNodeAdvancedPanel.tsx`, …; panels registered lazily |
| `widgets/<kind>/<Kind>Widget.ui + View + Panel` | [`editor/src/elements/widgets/`](../editor/src/elements/widgets/) | `SelectWidget.ui.ts`, `SelectWidgetView.tsx`, `SelectWidgetPanel.tsx`, …; views are what a deployed tool draws |
| `registry` (editor) | [`editor/src/elements/registry.ts`](../editor/src/elements/registry.ts) | `NODE_UIS`, `WIDGET_UIS` |

Shared by elements, not drawn: [`authoring/generation.ts`](../engine/src/authoring/generation.ts)
(how an AI writes a body), [`authoring/logic.ts`](../engine/src/authoring/logic.ts) (where a
body is kept and who runs it), [`elements/port.ts`](../engine/src/elements/port.ts),
[`elements/fileSelection.ts`](../engine/src/elements/fileSelection.ts); on the editor side
[`elements/fields/`](../editor/src/elements/fields/) (settings several panels share) and
[`elements/nodes/gui/guiWidgets.ts`](../editor/src/elements/nodes/gui/guiWidgets.ts) (a page's
widgets and the ports the engine derives from them).
