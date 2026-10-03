# Licences

**Checked on 3 October 2026, at 0.5.0: nothing in AI-Graph conflicts with a licence.** The part
that can change without anyone writing a line here -- the packages it installs -- is
checked again on every push, in the *Licences* step of
[CI](https://github.com/Archimedes79/AI_Graph/actions/workflows/ci.yml) (`npm run licenses`).

## What was checked, and what it found

| | Result |
|---|---|
| AI-Graph's own licence | [PolyForm Noncommercial 1.0.0](../LICENSE), with a `Required Notice:` line naming the copyright holder. The `package.json` files declare it by its SPDX name, `PolyForm-Noncommercial-1.0.0`. |
| Every copy carries those terms | The repository and every download have `LICENSE` at their top, the container image at `/app/LICENSE`, and every deploy bundle beside its `run.sh`. Tests fail without it: `scripts/package.test.mjs` for the download, `engine/src/cli/bundle.test.ts` for a bundle. |
| Code by others in the repository | None. Everything not written here is an npm package, installed from `package-lock.json` and never committed. |
| Packages the page is built from | 48 in the built page's `licenses.txt`: MIT 38, ISC 9, BSD-3-Clause 1 -- the libraries it imports, and two build tools for the code they write into it, the loader of its chunks and its base stylesheet. `npm run licenses` reads the lockfile, not the build, and counts 88 in this group: MIT 78, ISC 9, BSD-3-Clause 1. |
| Their notices | Each build writes `licenses.txt` beside the page: every package it is made of, with that package's own licence text -- what MIT, ISC and BSD ask for, and what a minified build otherwise drops. The page links it (`rel="license"`); the download carries it in `editor/dist/`, a deploy bundle in `web/`. |
| Development tools | 377 packages that build and test it: MIT 323, ISC 30, Apache-2.0 9, BSD-2-Clause 9, BSD-3-Clause 3, MIT-or-CC0 1, plus browser-support data under CC-BY-4.0 and an argument parser under the Python licence. Only the container image carries them, as npm installed them: each in its own folder, with its own licence file. |
| Copyleft | No package under GPL, LGPL, AGPL or MPL is installed at all. (The operating system inside the container image is another matter: see below.) |
| Example data | `examples/data/stories/` and `examples/data/paper/` are fiction written for the examples, and the paper says so in its byline. `examples/data/word/bodenfeuchte.docx` is a fictitious study that says so ("fiktive Studie", "Erika Mustermann, Beispielinstitut"). `examples/data/portfolio_review/` holds exports with placeholder identifiers (`XX…`). `examples/data/*.csv` hold a few rounded population and area figures: facts, not anyone's text. |
| Node.js in the downloads | The downloads for Windows and Linux (`ai-graph-windows.zip`, `ai-graph-linux.zip`) carry the official Node.js binary for it, so nothing has to be installed. Node.js is MIT; what it is built from (V8, libuv, OpenSSL, ICU and others) comes under permissive licences that ask for their notices to travel along. They do: Node's own `LICENSE`, which lists every one of them, goes into the zip as `node/LICENSE`, and `scripts/package.test.mjs` fails without it. The binary is fetched from nodejs.org in CI and checked against the checksums published there. |
| Images | `docs/images/hero.png` is a screenshot of AI-Graph itself. |
| Loaded from elsewhere | Nothing: the page loads no fonts, scripts or styles from another site. |

What someone builds with AI-Graph stays theirs: a bundle's `README.md` says that the
graph, its page and its nodes belong to whoever built them.

## What the check holds every package to

`npm run licenses` (`scripts/licenses.mjs`) reads the licence each package declares in
`package-lock.json` and fails if one is outside these:

- **What the page may be built from** -- its libraries, and the two build tools that write
  code into it: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, licences whose
  one condition is that the notice travels along.
- **Development tools**, which only the container image carries, each with its own
  licence file: those, and CC0-1.0, CC-BY-4.0, Python-2.0 or BlueOak-1.0.0.

A package with no licence given fails too, and so does an expression that mixes AND and
OR, which a person should read.

## The container image

The image published from `main` is built on the official Node.js image for Alpine
Linux. The operating system in it -- the C library, the system tools -- comes under its
own licences, some of them GPL, as in every image built on that base. AI-Graph runs on
it and is not derived from it, and Alpine publishes the sources.
