# User guide: make a small tool in 30 minutes

How to go from nothing to a working tool with the mouse, and where the time goes. It was
written by building the [population plotter](../examples/population_plotter/) in the
editor from an empty canvas, with the steps below, on `gemini-flash-lite-latest`; what is
measured says so, the rest is an estimate.

A *small tool* here means what the three master examples are: **a page and one to three
nodes** — choose a file, get a chart; choose a folder, get a summary of each file; a chat
with a model. [`masterExamples.test.ts`](../editor/src/masterExamples.test.ts) builds each
of them the way this guide does (a node dropped, blocks added, a wire dragged) and runs it.

## The time budget

| Step | Time | What decides it |
|---|---|---|
| Download, unzip, start | 3–5 min | A 35 MB (Windows) or 44 MB (Linux) zip; Node.js is inside. |
| Give it a model | 5 min hosted · 10–60 min local | Hosted: an account and an API key. Local: installing a runtime and downloading a model of several GB. |
| Build the page | 1–2 min | Two blocks for the plotter. |
| Add a node and wire it | 1–2 min | Two drags. |
| ✨ writes the node's three files | 1–2 min | Measured: each of the three finished within the 8–15 s waited for it, on a small hosted model. |
| Run it, look, correct one thing | 3–10 min | **This is where the time goes** — see below. |
| Save, hand it on | 2 min | A folder name; one click on 🚀. |

About **15–25 minutes** for a first tool of this size, with a hosted model: that is inside
30. The tool with a model in it (section 6) adds about ten, estimated, because its input has
to be named and told to run per item.

It is not inside 30 when the model has to be downloaded first, when the data is messier than
the sample, or when the tool grows past about four nodes. The sections below say what costs
the time.

## 1. Install (3–5 min)

Download the zip for your system from the [releases page](https://github.com/Archimedes79/AI_Graph/releases/latest)
— [Windows](https://github.com/Archimedes79/AI_Graph/releases/latest/download/ai-graph-windows.zip)
or [Linux](https://github.com/Archimedes79/AI_Graph/releases/latest/download/ai-graph-linux.zip),
both x64 — unzip it, and start `run.cmd` (Windows) or `./run.sh` (Linux). The editor opens in
your browser on <http://127.0.0.1:8000>, or the next free port. Nothing else is installed.

macOS, or a checkout instead of a zip: Node 24 or newer, then `./start.sh` — see
[install.md](install.md). Keep a checkout out of a folder that Dropbox or OneDrive syncs:
they lock files while `npm ci` and the build replace them, and both fail with `EBUSY` or `EPERM`.

## 2. Give it a model (5 min)

✨ writes a node's files by asking a model, and an AI node asks one every time it runs. So
this comes before the first node.

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. In the editor: **⚙ Settings → Keys and addresses**, paste it next to *Google Gemini*,
   **Save**. Keys are write-only: they are saved on this machine and never shown again.
3. In the same dialog, under **AI**: provider *Google Gemini — free tier*, model
   `gemini-flash-lite-latest`, **Save**. The line *Now: google / gemini-flash-lite-latest*
   confirms it.

Use the `-latest` names: dated Gemini names are retired. A small, fast model is the right
choice for ✨: in the run this guide comes from, each file was written in seconds. A larger
one writes better code and takes longer; a model on your own machine (Ollama, LM Studio —
[ai-providers.md](ai-providers.md)) costs nothing per call but can take minutes per answer,
more with a model that "thinks". With nothing set, the editor tries a local Ollama, and ✨
fails until one is running.

## 3. Build the tool (about 10 min)

The example is the population plotter: choose a CSV of countries and numbers, see a bar
chart. Its pieces are a **page** (what the person sees), a **node** (what it does), and two
**wires** between them.

**The page.** Name the tool in the field at the top left, then open the **Page** tab. The
left column lists blocks; click **File or folder**, then **Chart**. They appear on the page.
That is the whole page: a block that asks for a file, and a block that shows what arrives.
(Typing `/` on the page opens the same list.)

**The node.** Back on the **Graph** tab, the page is already a node, with a dot for each
block: *File or folder* gives out the file the person chose, *Chart* takes in what to draw.
Click the gear in the left column — the code node — and it appears, with its panel open on
the right.

**The wires.** Drag from the page's *File or folder* dot to the code node's input dot, and
from the code node's output dot to the page's *Chart* dot. The page node draws what the
person gives on its left and what it shows on its right, so the two wires loop around it.

**The node's text.** In the panel, the top box is the node in your own words. Say what it
should do, with what comes in and what goes out:

> Read the population CSV (a country column and a population column) and show a bar chart
> of the population per country.

**✨ writes the rest.** Press **✨ Input**, then **✨ Output**, then **✨ Code**, in that
order — each is written from the one before. You get three files, each shown in the panel
and each a plain file in the project folder:

- `input.js` — what one call of the node is handed, with an example. Here a CSV as text.
- `output.js` — what it hands on, with an example. Here a chart: kind, title, points.
- `code.js` — the function between them. It is tried on the example and repaired before you
  see it.

You do not have to write any of them; you can change any of them. A node's name follows its
text. To change one thing later, say it in the bar under the canvas — *Say what to change*,
scoped to the open node or to the whole graph — rather than editing by hand.

**Shortcut:** the wand in the toolbar (*Write every empty node, in the order the graph runs*)
writes the files of every node that has none yet, so a graph of several nodes with their texts
is one click.

## 4. Run it (2 min)

**▶ Run** runs the application, as an IDE does. The graph needs a file, so a *Before
running…* dialog asks for one: type or **Browse…** to a CSV and press Enter. The page opens
on the **App** tab and the chart is drawn. After a run, every node shows what it made under
its port, so a wrong node is visible in place.

There is a sample at [`examples/data/three_countries.csv`](../examples/data/three_countries.csv).

## 5. Save it and hand it on (2 min)

**File → Save as…** and a name without `.json` makes a **project folder**:
`flow.json` (the nodes and a line per wire), `page/` (the blocks), and one folder per node
under `nodes/` with its `input.js`, `output.js` and `code.js`. They are plain text, so
`git diff` reads them and your own editor can open them.

**🚀** downloads the tool as a zip: the engine, the graph and its page. Whoever receives it
unzips it and starts `run.cmd` or `run.sh`; the page is there, with no editor.

## 6. A tool with a model in it: summarize a folder (about 10 min)

The same pattern with an AI node: choose a folder of `.txt` files, and one window shows a
summary of each. The sample is [`examples/data/stories/`](../examples/data/stories/), three
short stories. It differs from the plotter in three places, and the third is the one that
cost the most time to find.

**The page.** Click **File or folder** and **Text output**. On the picker: tick **⚡ Using this
starts the graph** (choosing a folder is what runs it), set **Mode** to *Directory (list of
files)*, **File types** to `.txt`, and **Folder** to where the stories are. A path typed
there is what the page starts on.

**The node and the wires.** On the Graph tab, click the AI node in the left column. Wire
the picker's dot to its left dot, and its right dot to the page's *Text output* dot. A wire
from a picker makes the node read the file at each path, so what it is handed is the text.

**Name what comes in, before ✨.** Open the panel's **Advanced — ports, model, tools,
images, failures**:

1. Change the input's name from `prompt` to what it holds: `story`. The default says *what
   to ask*, and ✨ Input believes it: given `prompt`, it twice wrote an example that was not a
   story -- first an invented one, then the node's own sentence -- and an example answer to
   match.
2. Tick **Run once per item**. Without it the model is handed the whole list in one call
   and writes one summary of everything.

**Text, a real file, then ✨.** In the top box:

> Summarize one short story: its title, then two sentences -- what it is about, and where
> it ends up.

Press **⟳ From the graph** under *Example files*: it runs the page and attaches the first
story. Then **✨ Input**, **✨ Output**, **✨ Prompt**. An AI node's third file is its
instructions, `prompt.md`, not code. `input.js` now holds the first story's text under
`story`, and `output.js` a summary of it. In the run measured here the three took about 36 s
on a small hosted model.

**Run it.** **▶ Run** opens the **App** tab with the folder in the path box, and — because of
the ⚡ — waits for you: press **Enter** in the box. Three stories were summarized within ten
seconds, one summary under the other in the text window.

## Where the time goes

**1. The first run on real data.** ✨ writes the code against the *example* in `input.js`.
A CSV with other column names, a decimal comma, or a header on row three runs fine on the
example and fails on your file. Give ✨ Input the real file before pressing ✨ Code — **⟳
From the graph** or **Add a file…** in the panel, or drop one on the node. That one step is
the difference between a first run that works and ten minutes of correcting. The same goes
for what the input is *called*: a node with its default input `prompt` and a wired file
produced a wrong example twice in a row here, before it was named `story`.

**2. Saying it precisely.** A vague text gets a vague node. *Plot the data* writes something;
*bar chart of the population per country, largest first* writes what you meant. When the
result is almost right, change it with one sentence in the bar under the canvas instead of
rewriting the text.

**3. A slow model.** A tool with an AI node asks the model once per run, or once per item.
Twenty files at 10 s each is three minutes of waiting each time you try it. Try on one file.

**4. A model that does not know the shape of your problem.** ✨ with a small model is good at
one node with a clear task. It is weaker at many nodes at once: asked to build a whole tool
from one sentence (*File → ✨ AI Graph…*), the same model returned in about ten seconds a
four-node graph and a warning that one of its AI nodes would run once on everything instead
of once per item. Build from a page and one node, run it, add the next. The whole-graph
generator is for a first sketch.

**5. Words.** The plotter needs four: a page, a node, a port, a wire. A tool that starts on
a button or a clock, or that filters, needs an event (⚡) and a gate (◆);
[graphs.md](graphs.md) explains them when a tool gets there.

## When something does not work

- **A node shows an error under its port, or is skipped.** Open it, press **▶ Try**: it runs
  on the example in `input.js`, held to the example in `output.js`. A failing example says
  which of the two is wrong. **✨ Fix** repairs the body from that error.
- **✨ does nothing, or answers with an error.** The model setting: ⚙ Settings → AI shows
  *Now: provider / model*. A key that is missing or a local server that is not running both
  end here.
- **What did it send?** **What ✨ sends** next to each ✨ shows the request word for word.
- **The graph reports a problem before it runs.** The list names the node and what to
  change; it is the same check CI runs on every example.
- **It runs and the page stays empty.** The wire is on the wrong dot, or the chart's input
  has nothing wired to it.

## Next

[`examples/`](../examples/) holds nine tools to open and read, from the plotter to a team of
AI analysts. [graphs.md](graphs.md) is the reference for every node and block;
[deployment.md](deployment.md) for what 🚀 produces.
