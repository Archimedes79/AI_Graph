# Open items

Maintained by hand, newest state first. One line per item; the *why* lives in the
commit that closes it.

## Decisions waiting on you

- **`NodeConfig` is one flat type holding every element's fields** (`frontend/src/types/graph.generated.ts`,
  generated from `backend/app/models/graph.py`). Adding a field to one element edits a
  type every element imports. The engine already avoids this (`RawConfig` + each element
  reads what it knows); the editor does not. To discuss.
- **The `Element` base class is a wide interface** (`logic`, `generation`, `ports`,
  `execute`, `isMemory`, `hasInterface`, `deployNeeds`). What has worked is handing out
  small objects (`Logic`, `Generation`) rather than adding hooks. To discuss.
- **Saving a graph starts Node.** Load/save ask the engine for element knowledge. On a
  machine without Node a save now fails where it used to succeed. Keep, or have the
  editor send the specs along?
- The sweep never rewrites a body that has one. Should there be a "rewrite all"?

## A · One tool, one tree

- [x] Root npm workspace; one `package-lock.json`; CI installs once at the root.
- [x] One element tree: each element's editor half lives in `engine/src/elements/<kind>/editor/`
      (`definition.ts`, `Editor.tsx`), compiled by the editor only; the engine's tsconfig
      and the bundle walk both skip `editor/`.
- [x] The engine is the front door: `node engine/src/main.ts --editor frontend/dist --api …`
      serves the editor on :8000 and forwards the routes it does not own yet to the Python
      server on :8001 (`start.py` dev and prod). Owned natively: `/api/execute/*`, `/api/elements/*`.
- [ ] Bring the remaining routes across, one at a time, deleting the Python side of each:
      `/api/files/*` (browse/upload — the engine's browse lists files only; the editor's
      dialog needs directories), `/api/runtime/ai-settings` (read **and write**),
      `/api/graphs/file/*` (+ `node_files.py`, 371 lines), `/api/deploy/*`,
      `/api/ai/*` (+ `ai_service.py` 973, `code_refine.py` 230, `skeleton.py` 138).
- [ ] Then delete `backend/`, `start.py`'s second process, and the Python half of
      `build_editor_exe.py` / `run_prod_frozen` (the exe still runs uvicorn in-process;
      it is not flipped yet). `docker-compose.yml` and `backend/Dockerfile` likewise.
- [ ] Then the names: `frontend/` → `editor/`, and `engine/src/elements/` may lift to
      `elements/` at the root once nothing else is beside it.
- [ ] The DSL's source of truth: types from `engine/src/graph.ts` instead of
      `graph.py` + `export_graph_schema.py` + `genTypes.mjs`.
- [ ] `frontend/src/elements/shared/` and `registry.ts` are editor infrastructure, not
      elements; they stay in the editor and should be named as such.

## B · Code generation

- [x] Sweep: ✨ Generate in the toolbar writes every empty node in execution order,
      stops at a failure, refuses a graph the engine cannot run.
- [x] What generated code actually returned is written as the node's output contract, in
      the one generation path both buttons use.
- [x] A file/directory input shows an example-file attachment and a "what these files
      contain" contract; the sweep's preflight accepts either.
- [ ] Hand real values forward, not only the preview: `ProbeReport` returns a truncated
      text; the next node's `sample_inputs` want the actual outputs.
- [ ] Measured contract as structure (keys + types) rather than prose.
- [ ] The frame as a code prefix the model completes, not as prose (`skeleton.py` renders
      it already; move it to the engine, hand it to the model as the start of the body).
- [ ] Sweep into the engine (`engine/src/generate.ts`) once generation lives there.
- [ ] Python-isms left in prompts (`ai_service.py`, `code_refine.py`): default language is JS.

## C · Debts

- [ ] `ElementGeneration` (editor) duplicates `Generation` (engine): guard/success/
      promptField/targetField — held equal by a test, should be read from the engine.
- [ ] `AuthoredFileOption.tsx` is named after a concept that no longer exists.
- [ ] `test/models` (untracked), old bundles in `dist/`.
- [ ] `LICENSING-PROPOSAL.md` was an open decision; the file is gone, the question may not be.
