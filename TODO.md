# Open items

Maintained by hand, newest state first. One line per item; the *why* lives in the
commit that closes it.

## Decisions waiting on you

- **`NodeConfig` is one flat type holding every element's fields** (`frontend/src/types/graph.generated.ts`,
  once generated from a Python model, now hand-kept). Adding a field to one element edits
  a type every element imports. The engine avoids this (`RawConfig` + each element reads
  what it knows); the editor does not. To discuss.
- **The `Element` base class is a wide interface** (`logic`, `generation`, `ports`,
  `execute`, `isMemory`, `hasInterface`, `deployNeeds`). What has worked is handing out
  small objects (`Logic`, `Generation`) rather than adding hooks. To discuss.
- **A single-file executable is gone with PyInstaller.** The editor is `npm start` on a
  machine with Node. If a double-clickable file matters, the candidates are Node's
  single-executable applications or a small installer that brings Node; neither is
  started.
- The sweep never rewrites a body that has one. Should there be a "rewrite all"?

## A · One tool, one tree

- [x] Root npm workspace; one lockfile; CI installs once at the root.
- [x] One element tree: `engine/src/elements/<kind>/` holds `element.ts` and `editor/`.
- [x] One runtime. The Python server is deleted; the engine serves the editor
      (`node engine/src/main.ts --editor frontend/dist`) and answers every route the
      editor calls: files, settings, project files, generation, bundles. `npm start`,
      `npm run dev`, `docker compose up`.
- [x] Old graphs open everywhere: the one-time migrations run inside `parseGraph`.
- [ ] The names: `frontend/` → `editor/`; `engine/src/elements/` may lift to `elements/`
      at the root. Rename once the tree has settled — every path in docs and imports moves.
- [ ] `frontend/src/store/graphStore.ts` still carries its own copy of the alias
      migrations (`migrateLegacyNode`); the engine's `migrate.ts` does the same on load.
      Delete the editor's copy.
- [ ] `frontend/src/elements/shared/` and `registry.ts` are editor infrastructure, not
      elements; name them as such.
- [ ] `ai-settings.example.json` still shows `*_base_url` endpoint keys; the file is
      keyed by provider name now (old files are read either way).

## B · Code generation

- [x] Sweep: ✨ Generate in the toolbar writes every empty node in execution order,
      stops at a failure, refuses a graph the engine cannot run.
- [x] What generated code returned is written as the node's output contract, in the one
      generation path both buttons use.
- [x] The probe hands back the real outputs (`probe.outputs`), not only a preview.
- [x] A file/directory input shows an example-file attachment and a "what these files
      contain" contract; the sweep's preflight accepts either.
- [ ] Use `probe.outputs` as the *next* node's `sample_inputs` in the sweep, so from the
      second node on the verify pass runs against real data without a prior run.
- [ ] Measured contract as structure (keys + types) rather than prose.
- [ ] The frame as a code prefix the model completes, not as prose in the prompt.
- [ ] Sweep orchestration into the engine (`engine/src/host/editor/sweep.ts`), now that
      generation lives there; the toolbar then makes one call.
- [ ] A memory element (data, gui) as the next node: its contract is its own format, not
      the predecessor's output — confirm the sweep reads `data_format_prompt` there.

## C · Debts

- [ ] `ElementGeneration` (editor) duplicates `Generation` (engine): guard/success/
      promptField/targetField — held equal by a test, should be read from the engine.
- [ ] `AuthoredFileOption.tsx` is named after a concept that no longer exists.
- [ ] `/api/ai/complete` (raw completion) was Python-only and unused by the editor; it is
      gone. Anything outside the editor that called it needs `engine/src/ai/providers.ts`.
- [ ] `test/models` (untracked), old bundles in `dist/`, a root `.venv` and
      `backend/.venv` left on disk: local leftovers, ignored by git, safe to delete.
- [ ] `LICENSING-PROPOSAL.md` was an open decision; the file is gone, the question may not be.
