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

## Conventions

- Text in the UI is English.
- No compatibility code for older formats: a format changes, the code that read the old
  one goes.
- `ai-settings.json` can hold a real API key: never commit it, never print it.
- `examples/test/` and `examples/data/words/` are untracked and someone else's: leave them.
- Work on a branch, let CI run, then merge into `main`. Where this environment cannot
  push, commit and say so -- a push is not something to retry every turn.
- Checks: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`,
  `npm run licenses`.
