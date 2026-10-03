# Working on AI-Graph

## The documents describe; they do not forbid

README.md, docs/ and arch/ say how AI-Graph is and why. Their tone is sure of itself --
"five rules", "never", "deliberately left out" -- because they describe decisions, not
because those decisions are closed.

- **Argue.** When a rule, a claim or a test in this repository looks wrong, outdated,
  or in the way of what is asked, say so and say why -- before following it, and
  before working around it. Every rule here names its reason; a rule whose reason no
  longer holds is changed, not obeyed.
- **The person you work with decides.** What they say in the conversation comes before
  anything written in the repository. If you think it is a mistake, say so once, with
  the reason, then do what they decide.
- **Write so it stays arguable.** A claim in README or docs says what holds today and,
  where it can, which test holds it -- not that something may never change.

## Where things live

- `engine/` -- Node 24 runs its TypeScript as it is, with no build and no runtime
  dependencies; `engine/src/strippable.test.ts` rejects syntax that needs a compiler.
  `engine/src/host/editor/` is the editor's server side and never reaches a deploy bundle.
- `editor/` -- the React page (`npm run build` writes `editor/dist/`, which the engine serves).
- `examples/` -- project folders the tests and CI read, run and deploy.
- `scripts/` -- launchers, packaging, the licence check.
- Structure: `docs/architecture.md` and `arch/overview.md`. The product: `README.md`,
  `docs/user-guide.md`.

## Conventions

- Text in the UI and in the documents is English.
- No compatibility code for older formats: a format changes, the code that read the old
  one goes.
- `ai-settings.json` can hold a real API key: it is gitignored, never commit it, never
  print it.
- `examples/test/` and `examples/data/words/` are untracked and someone else's: leave them.
- Checks: `npm run typecheck`, `npm run lint` (the editor only), `npm run build`,
  `npm test` (engine and editor), `npm run licenses`. CI (`.github/workflows/ci.yml`) runs
  these and also `node --test scripts/launcher.test.mjs scripts/package.test.mjs`
  and `node engine/src/main.ts check` / `test --offline` over `examples/*/`.
- Work on a branch, let CI run, then merge into `main`. A green push to `main` rebuilds the
  `latest` pre-release and the container image, and a `vX.Y.Z` tag publishes a release, so
  a merge is a publication. Where this environment cannot push, commit and say so -- a push
  is not something to retry every turn.
