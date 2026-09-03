# What this branch is

`python-engine` is a snapshot, not a line of development. It is the last
commit at which AI-Graph still executed graphs in **Python** — the engine,
the batching, the run registry, the deploy bundler and the two
`graph-runner` entry points, about 7,300 lines that the next commit on
`main` deleted.

It exists so that decision stays reversible. Nothing here is being
maintained; `main` is where the project goes on.

## The state it captures

Commit `bc4a456`, "the editor runs graphs through the engine" — the point
where **both** engines were present and agreed. The Python engine still
ran everything; the TypeScript engine beside it in `engine/` had been
proven equal on every example, which is what made the deletion in
`9088a9b` defensible.

So this is not a pure-Python snapshot. It is the moment before the choice,
with both halves standing and one test suite covering them.

    backend/app/services/graph_executor.py   the executor
    backend/app/services/batching.py         per-item fan-out
    backend/app/services/run_registry.py     watchable, stoppable runs
    backend/app/services/deploy_service.py   the bundler
    graph-runner/run.py, serve.py            what a deployed bundle ran
    graph-runner/build_exe.py                PyInstaller, --embed-python
    engine/                                  the TypeScript engine, already equal

## Running it

    ./start.cmd            (Windows)
    ./start.sh             (macOS, Linux)

Tests: `python -m pytest` in `backend/` — 380 pass, 1 skipped, 1 xfailed,
verified when this branch was cut.

## What main has since gained

Roughly fifty commits. None of it exists here, and porting any of it would
mean writing it in Python a second time:

- **One language for authored bodies.** Code nodes are JavaScript only; the
  interpreter that runs the engine runs every body, so a recipient installs
  nothing. Here, a body may be Python and a bundle may need an interpreter,
  a virtualenv and pip.
- **A graph generated front to back.** The editor sweeps the graph in
  topological order, runs each node as it is generated, and hands the next
  one what the previous actually returned instead of a description of it.
- **Error ports.** Any node — ai, input, code, or a block on a page — can
  expose an optional second output and catch its own failure.
- **Blocks with a frame and a background of their own**, and three more GUI
  elements: select, slider, button.
- **A code body runs under Node's permission system.**
- **One file shape, no migrations**, and one folder per element holding
  both halves.

## If you ever come back to it

The question this branch answers is "what did the Python engine actually
do, and did it do it better?" — not "can we go back to it". Going back
would mean re-implementing fifty commits. Reading it to recover a specific
behaviour is cheap; reviving it is not.
