# Runtimes, GUI, and how to structure an element — research notes

Status: research, not a proposal. Written 2026-08-31 to answer three questions that
kept recurring: is there a TypeScript runtime worth moving to, would WASM help, and
what are the structural options for element code that has to serve both the diagram
and the deployed runtime.

Companion to [ELEMENT_CONTRACT.md](ELEMENT_CONTRACT.md) and [AGENTS.md](AGENTS.md).
Where a claim came from the web rather than from this repository, the source is linked
at the end.

---

## Part 1 — Runtimes

### 1.1 TypeScript runtimes exist, and there are three of them

| | TypeScript | Type checking | Notes |
|---|---|---|---|
| **Node 24** | `--experimental-strip-types` | none at runtime | Strips annotations only; enums, decorators and namespaces still need a bundler |
| **Deno 2** | native | `deno check` runs a real `tsc` pass | The only one that can fail on a type error before running |
| **Bun** | native | none | Pioneered type-stripping in 2022; fastest HTTP throughput of the three |

The relevant catch for a project like this one: Bun and Node **strip types silently**, so
a type error surfaces as a runtime crash. Only Deno offers a checking step. A codebase
whose whole premise is "typed ports, explicit contracts" would want that step in CI
regardless of runtime.

Everything this project's backend does is available on all three: `node:fs` for file
access, `node:child_process` for the code-node sandbox, `fetch` for streamed AI calls,
a long-lived process for scheduling. **There is no capability argument against
TypeScript.** The third-party surface to replace is small — the entire backend imports
exactly three non-stdlib packages:

| today | TypeScript equivalent |
|---|---|
| `fastapi` + `uvicorn` | Hono, or `Bun.serve` |
| `httpx` | `fetch` (built in, streams included) |
| `pydantic` | `zod` + `zod-to-json-schema` |

The argument against is cost and timing, not capability — see §3.5.

### 1.2 WASM: what it is actually for

The Component Model and WASI 0.3 shipped in February 2026, which changed WASM from a
browser curiosity into a real deployment target: composable modules written in different
languages, standardised access to files, clocks and sockets, native async. It is in
production for serverless (Cloudflare Workers, Fastly, Fermyon Spin), plugin systems
(Envoy, Zellij) and sandboxing.

**For this project, WASM is not an engine target.** The engine's job is orchestration —
topological ordering, HTTP calls, subprocesses, file I/O. None of that is compute-bound,
which is what WASM is for. The pattern the ecosystem settled on is "WASM does heavy
computation, JavaScript does UI and glue", and this engine is glue.

WASM is interesting here for exactly one thing, and it is a big one:

### 1.3 The finding: Pyodide can run *this* engine in a browser

Pyodide compiles CPython to WebAssembly. The question is not whether Python runs in a
browser — it does — but whether *this* backend does. Checked against what the backend
actually imports:

| needs | in Pyodide |
|---|---|
| `pydantic` (the whole DSL, migrations, schema export) | ✅ official Emscripten wheel — PEP 783 was accepted and pydantic ships one |
| `httpx` (streamed AI calls) | ⚠️ no raw sockets; `httpx2` has a JS-fetch transport, or use `pyodide.http.pyfetch` |
| `asyncio` (the executor is one long await) | ✅ |
| file access | ✅ `pyodide.mountNativeFS()` mounts a File System Access API **directory handle** into the Python filesystem |
| `subprocess` (the code-node sandbox) | ❌ not available — no threading, no processes |
| `fastapi`/`uvicorn` | ❌ and unnecessary: there is no server in this scenario |

So a browser build of the existing engine needs **two adapters, not a rewrite**:

1. **HTTP transport** — one seam, already narrow: every provider call goes through
   `ai_service`, and the only thing to swap is the client.
2. **Code runner** — `code_executor` shells out to a subprocess. In a browser that
   becomes either an `exec` inside the same interpreter (no isolation) or a second
   Pyodide instance in a Web Worker (isolation, at the cost of a second ~10 MB runtime).

Note what this does to the earlier reasoning: *the browser story does not require
TypeScript.* It requires two adapters behind seams that already exist.

### 1.4 What a browser genuinely cannot do

Corrected and precise, because this decides which use cases a browser build could serve:

| | browser |
|---|---|
| GUI | ✅ |
| Read/write files, whole directories | ✅ Chromium; ❌ Firefox; partial Safari — **always after a one-time user gesture** |
| Remember a chosen folder across sessions | ✅ handles persist in IndexedDB, re-permissioned on return |
| Scheduling while the tab is open | ✅ throttled to ~1/min in background |
| **Scheduling unattended** | ❌ Periodic Background Sync is Chromium-only, PWA-only, and the browser picks the interval (hours) |
| JS code node | ✅ Web Worker |
| **Python code node with pip packages** | ⚠️ Pyodide ships numpy/pandas/matplotlib and `micropip` installs pure-Python wheels; arbitrary pip is out |
| Local LM (Ollama, LM Studio) | ✅ with CORS configured on the server |
| Cloud LM | ⚠️ the API key would live in the browser |

Two hard blockers remain: **unattended scheduling** and **arbitrary pip packages**.
Files are not a blocker on Chromium, which is the correction that matters most.

A browser build is therefore not a replacement for the local runtime. It is a **third
deployment target** — after the editor and the bundle — for graphs that need neither a
schedule nor pip: "here is a link, drop your folder in, your files never leave the
machine."

---

## Part 2 — GUI

### 2.1 The catalogue question is already answered by prior art

Node-RED Dashboard 2.0 is the closest comparable system: a flow-based tool whose nodes
build a user interface. Its widget set, which is what a decade of use converged on:

- **General**: button, markdown, text, spacer, notification, audio, template
- **Form & controls**: text input, dropdown, radio group, slider, switch, **form**
- **Data**: chart, table, progress
- **Event**: communicates with the flow without rendering anything

Three things in that list are worth reading closely, because each corresponds to a
decision this project has not made yet:

1. **`spacer` and `markdown` exist.** Presentational widgets are not an afterthought; a
   UI made only of inputs cannot be laid out. This project has no way to write a heading.
2. **`form` is one widget, not five.** A form groups fields and emits them together —
   the schema-driven approach, rather than a widget kind per control.
3. **`template` exists** — arbitrary HTML authored by the user. The escape hatch, kept
   as one clearly-marked widget rather than as the general model.

Node-RED also separates layout into `ui-group` / `ui-page` config nodes with four layout
types (Grid, Fixed, Notebook, Tabs). This project has one grid per gui node and no
concept of a page.

### 2.2 Three architectures for "far more GUI elements"

**(a) Curated kinds.** One element per control. Typed, deployable, visible in the graph.
Cost is linear: after the `DisplayWidget` base, a new kind is a small file, but it is
still a file per control.

**(b) Schema-driven.** One `form` widget whose config is a list of fields
(name, type, default). `ports(widget)` already returns a *list* — today with one entry.
Returning one port per field needs no contract change at all. Text, number, choice,
switch and date become **field types**, not widget kinds. This is the highest
value-per-line option and it is what Node-RED's `form` validates.

**(c) Template escape hatch.** The widget authors HTML/JS, AI-generated like a code node,
and declares its ports. Unlimited, and it buys two problems: authored script in a bundle
you hand to someone else executes in *their* browser, and the ports are only as honest as
the declaration beside them — which breaks the project's central promise that what flows
between nodes is visible in the graph. Node-RED ships this as `template`, one widget among
twenty, not as the model.

### 2.3 ComfyUI's answer to the two-declaration problem

ComfyUI defines a node as a single Python class with `INPUT_TYPES` (a classmethod, so
dropdown options can be computed at load time) and `RETURN_TYPES`. **The frontend
generates the node's widgets from that declaration.** There is no second, hand-written
frontend definition.

That is the same problem this project solves with two files plus a contract test, and it
is the strongest available evidence that generation is a real answer rather than a
theoretical one — see §3.4.

### 2.4 What makes the current runtime window look unfinished

From `GuiWindow.tsx`, not from taste:

- Every widget gets the same chrome unconditionally: a bordered box, a label above, and a
  `→ <first 80 characters of the output>` line below. A chart gets a caption and a
  truncated text dump of its own data underneath. **That is an inspector, not an
  interface** — and it is one facet away from being fixed (`chrome: 'framed' | 'bare'`,
  the `→` line becoming a debug toggle).
- There is no presentational widget, so no title, no explanatory text, no separator.
- The palette is a fixed dark theme in TypeScript constants. As CSS variables it would
  cost little and would unlock light mode and a per-graph accent colour, so a deployed
  tool stops looking like the editor that made it.
- `setWidgetValue` writes every keystroke into the graph through `updateNode`, so typing
  in a chat widget marks the graph unsaved, character by character.

---

## Part 3 — Structuring element code for two consumers

The real question behind "inheritance or another structure": an element's code serves the
**diagram** (an editor panel, a canvas node, port rendering) and the **deployment** (an
`execute`, vendored into a bundle). Four structures answer that, and this project has
already used two of them.

### 3.1 Inheritance (what this project does now)

`Element` → `NodeElement` / `GuiWidgetElement` → concrete, with one intermediate class
(`DisplayWidget`) where two widgets genuinely shared code.

Works when the axis of variation is stable and shallow. It broke down once already, in a
way worth remembering: the natural-looking intermediate class (`SnippetElement`, "elements
whose body is executed") separated nothing, because *every* element executes — an LLM call
is an execution too. The variation was not "does it execute" but "what runs the body",
which is data, not a subclass.

**The rule that survived: an intermediate class earns its place by carrying code, never by
naming a category.**

### 3.2 Composition / ECS

Every entity is defined by the components attached to it, not by its position in a
hierarchy. The standard argument applies here: with inheritance, the class count explodes
as behaviour combinations multiply.

This project is already halfway there without calling it that. `AuthoredFile`,
`Generation`, `DeployNeeds`, `config_fields`, `is_memory` and `snippet_failure` are all
**components declared as data**, not methods overridden in a subclass. The remaining
inheritance carries only real shared code.

That mix is the right end state for something this size. Full ECS — no classes at all,
systems iterating over component tables — buys decoupling that matters at thousands of
entities and costs readability at ten.

### 3.3 Two independent files (Node-RED)

A Node-RED node is a `.js` runtime file and a `.html` editor file. They share **no code
and no generation**; they are linked only by using the same type name. This is exactly
the split this project has (backend element + frontend definition), and Node-RED has
shipped it for over a decade.

Worth knowing before treating the split as a defect: it is a viable, long-lived design.
Its cost is precisely the one felt here — the two halves can disagree, and nothing but
discipline stops them. This project already went one better by adding a contract test.

### 3.4 One declaration, generated consumers (ComfyUI)

The node is declared once; the editor UI is generated from the declaration.

For this project the generator **already exists**: `npm run gen:types` produces
`graph.generated.ts` from the pydantic models, and `checkTypesUpToDate.mjs` fails CI when
it drifts. Extending it from the *models* to the *element descriptors* — `Generation`,
`authoredFile`, `config_fields`, `is_memory` — turns the contract test from a check into
a guarantee, and removes the hand-written half of every element definition.

What cannot be generated: `ConfigEditor` and `RuntimeWidget` are React components, and a
component is not a declaration. So the frontend element file would shrink to its
components, with everything declarative arriving from the backend. That is the honest
scope of this option, and it is still most of the win.

### 3.5 Interpreter vs. compiler — how deployment gets served

Three ways a visual tool can produce a deployable artifact:

| | how | this project |
|---|---|---|
| **Vendored interpreter** | ship the engine + the graph as data | ✅ current — `deploy_service` copies `app/` verbatim |
| **Compiler** | generate standalone source from the graph | rejected; there used to be a `compile()` per element |
| **IR + backends** | graph → intermediate representation → several targets | not needed yet |

The current choice is the reason `ELEMENT_CONTRACT.md` could delete an entire method from
every element: with the real engine shipped, generated code cannot diverge from executed
code, because they are the same code. Any move toward TypeScript, WASM or a browser build
should preserve that property first and optimise second — it is the strongest structural
guarantee the project has.

An IR would only start to pay if there were genuinely different execution targets (say,
local Python *and* browser Pyodide *and* a TS worker). Note that the Pyodide path in §1.3
does **not** need one: it is the same engine with two adapters.

### 3.6 Execution models, and where this one sits

The vocabulary, from dataflow literature:

- **Kahn Process Networks** — processes connected by unbounded FIFO channels, one writer
  and one reader each. Deterministic regardless of scheduling.
- **Dataflow process networks** — a special case: each process is repeated *firings* of an
  actor, each firing a quantum of computation.
- **Data-driven (push)** — a node fires as soon as its inputs are available.
- **Demand-driven (pull)** — a node fires only when something downstream needs its result.
- **Hybrid** — push until there is a token surplus, then pull.

`execute_graph` is **data-driven, level-synchronous**: topological levels, every node in a
level fired concurrently, one firing per node per run. Batching is the actor idea in
miniature — `per_item` fires the node once per token.

What the alternatives would buy, concretely:

- **Demand-driven** would let a graph compute only what a chosen output needs — useful the
  moment graphs get large enough that running everything is wasteful. It costs the current
  simple story about `partial` results and about which nodes ran.
- **True KPN** (per-node queues instead of levels) would let a slow node overlap with a
  fast one instead of the level waiting for its slowest member. This is the one with real
  headroom for AI graphs, where node durations differ by orders of magnitude. It is also a
  rewrite of the file where correctness is most expensive.
- **Incremental / dirty-marking** — re-run only what changed since the last run. For an
  editor where you press ▶ repeatedly while tweaking one node, this is probably the
  highest-value execution change of the three, and it composes with the current model
  rather than replacing it.

---

## What this suggests, in order

1. **Do not port to TypeScript.** No capability gap, small dependency surface, but the
   prize you actually want (one element declaration) is available for a fraction of the
   cost via §3.4, and the deploy guarantee in §3.5 would have to be rebuilt.
2. **Extend the type generator to the element descriptors** (§3.4). Days, not months, and
   it removes the hand-written half of every element definition.
3. **GUI: `chrome: 'bare'`, then presentational widgets, then the `form` widget** (§2.2b,
   §2.4). Validated by Node-RED's own catalogue; none of it needs an engine change.
4. **If "share a tool as a link" ever becomes a goal, build the Pyodide adapter, not a
   TypeScript engine** (§1.3). Two seams, both already narrow.
5. **Leave the execution model alone** until graphs are big enough to hurt; then look at
   incremental re-run before KPN (§3.6).

---

## Sources

- [TypeScript without tsc in 2026: type-stripping in Node.js 24, Bun and Deno compared](https://jsmanifest.com/typescript-type-stripping-node-bun-deno)
- [Node.js vs Bun vs Deno 2 in 2026](https://dev.to/moksh/nodejs-vs-bun-vs-deno-2-in-2026-which-javascript-runtime-should-you-actually-use-260e)
- [Pyodide — dealing with the file system](https://pyodide.org/en/stable/usage/file-system.html)
- [Pyodide — accessing files quick reference](https://pyodide.org/en/stable/usage/accessing-files.html)
- [Pyodide FAQ](https://pyodide.org/en/stable/usage/faq.html)
- [pyodide.http — pyfetch and pyxhr](https://pyodide.org/en/stable/usage/api/python-api/http.html)
- [Building Emscripten wheels for Pyodide and PyPI (PEP 783) — Pydantic](https://pydantic.dev/articles/emscripten-wheels-pydantic)
- [httpx2 — JS fetch transport for Pyodide/Emscripten](https://github.com/pydantic/httpx2)
- [WebAssembly Component Model and WASI 0.3 in 2026](https://jsmanifest.com/wasm-component-model-wasi-javascript-developers)
- [The WebAssembly Component Model](https://component-model.bytecodealliance.org/)
- [WebAssembly beyond the browser in 2026](https://zeonedge.com/blog/webassembly-server-side-wasm-wasi-component-model-2026)
- [Node-RED Dashboard 2.0 — widgets](https://dashboard.flowfuse.com/nodes/widgets.html)
- [Node-RED — creating your first node](https://nodered.org/docs/creating-nodes/first-node)
- [ComfyUI — custom node server overview (INPUT_TYPES / RETURN_TYPES)](https://docs.comfy.org/custom-nodes/backend/server_overview)
- [Lee & Parks, *Dataflow process networks*, Proceedings of the IEEE](https://bears.ece.ucsb.edu/class/ece253/papers/lee_parks_ieee95.pdf)
- [Properties of Kahn Process Networks](https://users.ece.utexas.edu/~bevans/courses/ee382c/lectures/11_pn/scheduling1.html)
- [Entity component system](https://en.wikipedia.org/wiki/Entity_component_system)
