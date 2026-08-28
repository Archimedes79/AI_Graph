# One shape for every element — concept paper

Status: written 2026-08-28 as a proposal; **steps 1-5 of the migration order in §5 are
implemented** (branch `element-contract`). Step 6 -- checking the frontend descriptors
against the backend ones in the contract test -- and step 7's README pass are open.
Companion to [AGENTS.md](AGENTS.md)'s "Object-oriented element contract", which describes
what the code does now.

One thing changed during implementation, for the better: the contract sentence and the
generator kind do **not** get mirrored into the frontend descriptor. The request names the
element, and `routers/ai.py`'s single `POST /api/ai/generate` resolves both server-side
via `registry.generation_for` -- so the sentence describing what `execute()` will do with
a snippet exists exactly once, in the element file that implements it.

## The goal, in one sentence

A node type and a GUI widget kind should be *the same kind of object*: a name, one
authored file behind it, an example of what its input looks like, one generation
function that writes its body from a prompt plus what the graph around it says, and
one declaration of what it emits — with everything else inherited from a base, so a
new element is a short file that overrides three or four things.

Today five of those six facets already work that way. The generation function does
not, the example exists three times under three names, and the output declaration
lives in a tab that only two of six node types have.

## 1. Where the shapes diverge today

### 1.1 Generation is owned by the shells, not by the elements

`NodeEditor.tsx` builds four hard-coded handlers — `handleGenerateCode`,
`handleGeneratePrompt`, `handleGenerateDataFormat`, `handleGenerateSelectorCode` —
and passes *all four* to *every* `ConfigEditor`, each of which picks the one prop it
recognises. Adding a node type that generates something means editing the shell, and
`AGENTS.md`'s promise ("a cheap agent implements one element by reading one file")
does not hold for this facet.

`GuiWidgetEditor.tsx` is one step better — it passes a single `onGenerate` — but the
handler behind it is an `isPlot` ternary threaded through eight lines: prompt field,
guard message, success message, contract string, input port, output port, target
field. That is a kind-switch in a shared shell, which is exactly what the element
contract exists to prevent.

`OutputFormatEditor.tsx` is a fifth generation site with its own `useGenerate`,
its own guard, and its own context-file field.

Consequences that are visible to a user, not just to a reader of the code:

- `image_view` has a `code` field with the same `run(inputs) -> {value}` contract as
  `plot_window`, and no ✨ Generate button at all — nobody added the sixth branch.
- The selector contract sentence is shared (`SELECTOR_CODE_CONTEXT`), but the four
  other pieces of a selector generation call are written out twice, once in
  `NodeEditor.tsx` for the `input` node and once in `GuiWidgetEditor.tsx` for the
  `input_picker` widget. They already differ: the node passes
  `config.config_context_file`, the widget passes `widget.example_input_path`.

### 1.2 "An example of the input" exists three times

| Field | On | Label in the UI |
|---|---|---|
| `NodeConfig.config_context_file` | every node | "Additional data (optional context file)" |
| `NodeConfig.output_context_file` | ai/code, Output tab | "Context file (optional, e.g. a sample output file)" |
| `GuiWidget.example_input_path` | plot_window, input_picker | "Example input" |

One concept, three names, three labels, and — because they are separate fields — a
node whose Config tab has a sample CSV attached still generates its output format
with no example unless the user attaches the same file a second time.

There is a fourth, better source that is not a field at all: `lastRunContext`, the
values the node actually received on the last run. It is read from the store and is
correctly *not* persisted (it would put sample data into the graph file).

### 1.3 The output declaration is a tab two node types have

`NodeEditor.tsx` decides the tab bar with `node.node_type === 'ai' || === 'code'`
for the real editor and `=== 'gui'` for a read-only summary. Everything else gets
two tabs instead of three. So "what does this element emit" is:

- an editable contract for `ai`/`code` (`output_format` + `output_format_prompt`),
- a derived, read-only sentence for `gui` (`WidgetOutputSummary`),
- a hard-coded sentence in `describeNodeOutput()` for `input` and `data`,
- nothing at all for `output`,

which is four mechanisms for one question, one of which (`describeNodeOutput`) is a
`switch` on `node_type` in shared code — the last such switch on the frontend.

### 1.4 What is already uniform, and stays that way

`authored_file()` / `authoredFile`, `ports()`, `execute()`, `create()`,
`runtime_requirement()`, `deploy_needs()`, one registry line per language, and
`node_files.py`'s single read/write loop over an `Authored`. The proposal below
extends that pattern; it does not replace it.

## 2. The target contract

Six facets, declared once per element, all optional except the first two:

| Facet | Node element | Widget element | Today |
|---|---|---|---|
| identity | `node_type`, `create()`, `label` | `widget_kind`, `ports()`, `label` | uniform |
| behaviour | `execute()` | `execute()` | uniform |
| authored file | `authored_file()` | `authored_file()` | uniform |
| **example input** | `example_field` | `example_field` | **3 names** |
| **generation** | `generation()` | `generation()` | **5 sites** |
| **output contract** | `output_contract()` | `output_contract()` | **tab for 2 of 6** |

### 2.1 `Generation` — one descriptor, five call sites collapse into one

```python
# backend/app/elements/base.py
@dataclass(frozen=True)
class Generation:
    """How this element's body is written by an AI, declared once."""
    kind: str                    # which generator: "code" | "prompt" | "output_format" | "data_format"
    prompt_field: str            # where the user's request lives
    target_field: str            # where the result is written
    prompt_on_node: bool = False # the ai node's request is node.description
    contract: str = ""           # the element-specific sentence(s) the model needs
    ports: Optional[Tuple[Tuple[str, ...], Tuple[str, ...]]] = None
                                 # fixed port names for a sub-snippet ( ("value",), ("value",) );
                                 # None means "this element's real ports"
    guard: str = ""              # message shown when prompt_field is empty
    success: str = ""            # message shown on success
```

The `contract` string is the important move: `PLOT_TRANSFORM_CONTEXT` and
`SELECTOR_CODE_CONTEXT` describe what the *backend element's* `execute` will do with
the generated snippet, so they belong in that element's file, next to the code they
describe — not in a shared constants module that every shell imports from.

Filled in per element:

| Element | kind | prompt_field | target_field | ports |
|---|---|---|---|---|
| `code` | code | `code_prompt` | `code` | real ports |
| `ai` | prompt | `description` (on node) | `system_prompt` | — |
| `data` | data_format | `data_prompt` | `data_format_prompt` | — |
| `input` (directory) | code | `selector_prompt` | `selector_code` | files → files |
| `input_picker` (directory) | code | `selector_prompt` | `selector_code` | files → files |
| `plot_window` | code | `code_prompt` | `code` | value → value |
| `image_view` | code | `code_prompt` | `code` | value → value |
| `output`, `text_io`, `gui` | — none — | | | |

`input` and `input_picker` end up with the *identical* descriptor, which is the point:
the same contract implemented once at both levels, rather than the same seven lines
written out twice and already drifting.

`GuiWidget.plot_prompt` is renamed to `code_prompt` so that a widget's authored
triple is `code_prompt` / `code` / `code_file` — byte-identical in naming to a code
node's. That also gives `image_view` its missing prompt field for free. One-time
rewrite in `_migrate_legacy_nodes` and `migrateLegacyNode`, per AGENTS.md's rule that
legacy names never survive as fields.

On the frontend the same descriptor rides on the element definition, and one shared
`runGeneration(element, subject, graphContext)` in `elements/shared/generation.ts`
builds the request from it. `NodeEditor.tsx` then passes exactly one prop —
`onGenerate` — the same one `GuiWidgetEditor.tsx` already passes, and each
`ConfigEditor` renders one button wired to it. The four named handler props and the
`isPlot` ternary both disappear.

### 2.2 `example_file` — one field, one label

`config_context_file`, `output_context_file` and `example_input_path` become
`example_file` on `NodeConfig` and on `GuiWidget`, migrated at load time from all
three. Every generation call — body, output format, selector, transform — reads that
one field, so attaching a sample CSV once serves every ✨ button on the element.

Storage stays a **path**, not inline content: a graph file must not grow sample data,
and the file on disk is the thing the user already has. It is written into the
authored file's header (`example:`) exactly as `context-file` is today, so the file
still stands on its own.

Losing the ability to attach a *different* sample to the output-format generator than
to the body generator is a deliberate trade: two attachments for one node is the kind
of choice that gets made once, wrongly, and then confuses.

### 2.3 `output_contract()` — the Output tab disappears

```python
@dataclass(frozen=True)
class OutputContract:
    editable: bool          # does a person declare this, or is it derived?
    describe: str           # one line for generation context and for the neighbour's prompt
```

Every element answers "what do I emit" through one method, which replaces
`describeNodeOutput()`'s `switch` on the frontend as well:

- `ai`, `code` — editable: `output_format` + `output_format_prompt`, the existing
  `OutputFormatEditor` rendered **inline in the Config tab**, under the body, where
  the rest of the element's declaration already is.
- `gui` — derived from its widgets (`WidgetOutputSummary`), rendered in the same
  place, read-only.
- `input`, `data` — derived, one sentence, same place.
- `output` — nothing.

With that, the tab bar is `config | preview` for every node type, and
`showManualOutputTab` / `showWidgetOutputTab` / the `tabs` ternary are all deleted.
The Config tab grows by one section; it already scrolls.

**Ports do not become authored.** The user's sketch has "Input- und
Outputschnittstellen" in the file. The *format contract* moves there and is
authoritative. The *port names* stay derived from the wiring and read-only in the
header, exactly as `node_files.py` does it today — a text file that renames a port
would silently detach edges, and that is a worse failure than a little asymmetry.

### 2.4 Inheritance, so specialisation stays possible

This is what keeps "the same" from meaning "the same shape hammered onto every
element". Backend, where classes already exist:

```
NodeElement (ABC)                 GuiWidgetElement (ABC)
├── generation()   -> None        ├── generation()   -> None
├── authored_file()-> None        ├── authored_file()-> None
├── output_contract() -> derived  ├── output_contract() -> derived
└── execute()      abstract       └── execute()      abstract

AuthoredCodeElement(NodeElement)          # new intermediate base
└── generation() = Generation(kind="code", …)   # code, input(dir) inherit
    CodeElement, InputElement

AuthoredCodeWidget(GuiWidgetElement)      # the same intermediate, one level down
└── plot_window, image_view, input_picker
```

An element overrides only what differs — `plot_window` overrides `contract` and
`ports`, and inherits the other five fields. `Generation` being a frozen dataclass
means an override is `replace(super().generation(w), contract=…)`, not a copied
literal.

Backend generators get the same treatment. `ai_service` already has `_generate_tagged`
as the shared machinery for three of the four generators, differing only in system
prompt and tag; that becomes:

```
Generator (ABC)              .run(description, context, model, provider) -> (text, explanation)
├── TaggedGenerator          system + tag; prompt, output_format, data_format are instances
└── CodeGenerator            code-block extraction + port list
GENERATORS: dict[str, Generator]
```

and the four endpoints `generate-code` / `generate-prompt` / `generate-output-format`
/ `generate-data-format` collapse into one `POST /api/ai/generate` taking `kind`.
`generate-graph` stays separate — it authors a whole document, not one element's body.

On the frontend, React has no useful class story, so "inheritance" is a factory:
`defineNodeElement(spec)` / `defineGuiWidgetElement(spec)` fill in every default and
return the frozen definition, and `codeGeneration({…overrides})` builds the common
descriptor. An element file stays a literal you can read top to bottom.

## 3. What this deletes

| Gone | Why it existed |
|---|---|
| 4 handler props threaded through every `ConfigEditor` | no per-element generation |
| the `isPlot` ternary in `GuiWidgetEditor` | same, one level down |
| `OutputFormatEditor`'s private `useGenerate` | fifth generation site |
| `describeNodeOutput()`'s `switch (node.node_type)` | no `output_contract()` |
| `showManualOutputTab` / `showWidgetOutputTab` / the tabs ternary | the Output tab |
| 2 of 3 example-file fields and their labels | three names for one thing |
| 3 of 4 generation endpoints and their request/response models | no `kind` |
| `SELECTOR_CODE_CONTEXT` / `PLOT_TRANSFORM_CONTEXT` as shared constants | contracts lived away from the code they describe |

Net: roughly 200 lines of shell code replaced by ~60 lines of shared machinery plus
5–8 declarative lines per element, and one new capability (`image_view` generation)
that falls out of the contract rather than being added by hand.

## 4. What this deliberately does not do

- **No renaming of `code` / `system_prompt` / `data_format_prompt` to generic field
  names.** The mapping from role to field is what `AuthoredFile` and `Generation`
  already express; renaming the fields themselves would rewrite every saved graph,
  every example, every deploy bundle and half the README to buy a uniformity that the
  declarations already provide. `plot_prompt → code_prompt` is the one exception, and
  only because it makes two widget kinds share one field they already share the
  contract of.
- **No per-type `NodeConfig` schema.** Still out of scope, still for the same reason
  (AGENTS.md, "Scope boundary").
- **No authored ports.** See 2.3.
- **No inline example data in the graph.** See 2.2.

## 5. Migration order

Each step is independently shippable and independently testable; the suites in
`test_element_contract.py` / `elementContract.test.ts` are already parametrised per
element, so each step extends them rather than rewriting them.

1. **Frontend generation descriptor.** Add `generation` to the two definition types,
   fill it in for all seven generating elements, add `runGeneration`, strip
   `NodeEditor.tsx` and `GuiWidgetEditor.tsx`. No DSL change, no backend change.
   `image_view` gains its button here.
2. **Output contract.** Add `output_contract()` / `outputContract`, move
   `OutputFormatEditor` and `WidgetOutputSummary` into the Config tab, delete the tab
   logic and `describeNodeOutput`'s switch.
3. **`example_file`.** One field on `NodeConfig` and `GuiWidget`, migration from the
   three old names in both migrators, single `ContextFileAttachment` per element.
4. **`plot_prompt → code_prompt`.** Same migration mechanism, one line each side.
5. **Backend generators.** `Generator` base + registry + `POST /api/ai/generate`;
   the old four routes become thin aliases for one release, then go.
6. **Backend element descriptors.** `generation()` and `output_contract()` on
   `NodeElement` / `GuiWidgetElement` with the intermediate `AuthoredCode*` bases, so
   the contract strings live next to the `execute` they describe and the frontend
   descriptors can be checked against them in the contract test.
7. **Docs.** AGENTS.md gets the new facets in its two tables; README gets the
   one-attachment-per-element and the vanished Output tab.

Steps 1–2 are pure frontend and carry the visible win. Steps 3–4 touch the DSL and
need the migration tests. Steps 5–6 are the backend half and can wait without
blocking anything.
