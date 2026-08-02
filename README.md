# AI-Graph

**AI-Graph** is a no-code, node-based AI workflow orchestration platform. Build complex, AI-driven automation workflows without writing code by connecting nodes in a visual graph editor.

---

## Projektbeschreibung

AI-Graph bietet eine grafische Oberfläche, in der Datenverarbeitungen als Graph aus verbundenen Blöcken erstellt werden. Ein Graph kann zusätzlich als JSON-DSL beschrieben, von einer AI erzeugt oder verändert und anschließend als eigenständige Anwendung deployed werden.

### Blöcke

- **Text Input** – Textwert als feste Eingabe oder zur Laufzeit abgefragt
- **File Input** – eine einzelne Datei lesen und Inhalt sowie Pfad ausgeben
- **Directory Input** – durchsucht ein Verzeichnis und gibt ausschließlich eine Liste gerooteter Dateipfade aus (`files`, Batch). Es liest keine Inhalte. Welche Dateien weitergereicht werden, kann per AI-Prompt (`selector_prompt`) auf editierbaren, prüfbaren Auswahlcode (`selector_code`) abgebildet werden, z. B. „nur `.md`-Dateien“.
- **AI** – Prompts mit Ollama, LM Studio, einem OpenAI-kompatiblen Endpunkt, OpenAI oder Anthropic verarbeiten
- **Code** – Eingänge mit Python oder JavaScript auf Ausgänge abbilden; AI kann den Code aus einer Beschreibung erzeugen
- **Read File (Code) / Read File (AI)** – Presets für die normalen Code-/AI-Blöcke: Eingang `paths` ist als `file_path`-Batch deklariert, `read_file_inputs` ist aktiviert. Dadurch werden Pfade vor der Ausführung automatisch zu Dateiinhalt aufgelöst (Text, oder Base64 bei binärem Format) – der Code-Block muss also keinen eigenen Dateizugriff programmieren, der AI-Block erhält echten Inhalt statt eines Pfad-Strings.
- **Merge / Split** – mehrere Werte zu einem Ergebnis zusammenführen (`merge_mode`: concat/sum/count/json_list) oder Text in eine Liste aufteilen
- **Text Output / Output** – Ergebnisse anzeigen oder in Dateien und Verzeichnisse schreiben

Blöcke werden über typisierte Eingangs- und Ausgangsports (Connectors) verbunden. Jeder Port beschreibt explizit:

- **Datentyp** – `text`, `file_path`, `binary`, `json`, `list` oder `any`
- **Einzelwert oder Batch** (`multi`) – z. B. ein Directory-Input liefert immer eine Liste von Dateipfaden, kein Einzelwert
- **Format** (optional) – ein MIME-/Formatname wie `application/json`, `text/csv` oder `image/png`; wird sowohl beim Empfang (Parsen von JSON/CSV, Lesen als Text vs. Binär) als auch beim Debug-Snapshot (Serialisierung) von den angrenzenden Blöcken berücksichtigt
- **Debug-Verzeichnis** (optional) – schreibt jeden Wert, der über diesen Connector läuft, zur Laufzeit als Datei zur Inspektion

Ein Connector wird per Einzelklick auf den Port bearbeitet (Format/Debug-Verzeichnis); ein Doppelklick auf den Node-Körper öffnet weiterhin den vollständigen Node-Editor – diese Trennung bleibt bewusst so, um beide Bearbeitungswege eindeutig zu halten.

Ein Ausgang darf mit mehreren Eingängen verbunden werden, mehrere Ausgänge dürfen in einen Eingang laufen. Die Ausführung erfolgt in abhängigen Stufen: parallele Blöcke einer Stufe werden abgeschlossen, bevor die nächste Stufe beginnt. AI-/Code-Blöcke verarbeiten Batches standardmäßig einzeln (`batch_mode: per_item`); für Aggregationen über den gesamten Batch (z. B. Summen) kann `batch_mode: whole_list` gesetzt werden, damit der Block die volle Liste in einem Aufruf erhält.

Jeder AI- oder Code-Block beschreibt seine Verarbeitung über Text. Diese Beschreibung kann direkt als AI-Prompt verwendet oder in ausführbaren Code übersetzt werden. Dadurch lassen sich auch komplexe Anwendungen ohne klassische Programmierkenntnisse modellieren; die Datenverträge des Graphen bleiben dabei explizit in den Ports und der JSON-DSL sichtbar.

Noch gesondert zu spezifizieren sind unter anderem Berechtigungen für Dateizugriffe, Fehler- und Wiederholungsstrategien, Versionierung von AI-Modellen sowie die genaue Konfiguration externer Dienste beim Deployment.

---

## ✨ Features

- **Visual Graph Editor** – drag-and-drop node canvas powered by ReactFlow
- **Node Types**:
  - **Text / File / Directory Input** – load data from configured sources; Directory Input only lists rooted file paths, it does not read content
  - **AI Node** – send prompts to Ollama (local LLM), OpenAI, an OpenAI-compatible endpoint, or Anthropic
  - **Code Node** – execute generated or hand-written Python/JavaScript
  - **Read File (Code) / Read File (AI)** – presets that auto-resolve `file_path` inputs to actual content before running
  - **Output** – capture results
  - **Merge / Split** – fan-in and fan-out multiple connections, with concat/sum/count/json_list aggregation modes on Merge
- **AI Code Generation** – describe what a node should do; the AI writes the code
- **AI Prompt Generation** – describe the AI's role; get a system prompt generated
- **Fan-in / Fan-out** – connect one output to many inputs, or merge many into one
- **Graph DSL** – graphs are JSON files; readable and writable by humans and AI alike
- **Execution Engine** – topological execution with full per-node status reporting
- **Deployment Tooling** – export a Docker Compose stack + standalone runner script
- **Graph Runner CLI** – execute any saved graph from the command line

---

## 🚀 Quick Start

### Option 1 – Docker Compose (recommended)

```bash
git clone https://github.com/Archimedes79/AI-Graph.git
cd AI-Graph
docker compose up --build
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000](http://localhost:8000)
- API docs: [http://localhost:8000/docs](http://localhost:8000/docs)
- Ollama: [http://localhost:11434](http://localhost:11434)

Pull an Ollama model (once):
```bash
docker exec -it ai-graph-ollama-1 ollama pull llama3
```

### Option 2 – Development mode

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# opens at http://localhost:3000
```

---

## 📖 Graph DSL

Graphs are stored as JSON and can be created, modified, or generated by an AI:

```json
{
  "metadata": { "name": "My Graph", "version": "1.0.0" },
  "nodes": [
    {
      "id": "n1",
      "node_type": "text_input",
      "label": "Greeting",
      "config": { "value": "Hello, World!" },
      "outputs": [{ "id": "output", "name": "Output", "kind": "output", "data_type": "text", "multi": false, "required": false, "description": "" }]
    },
    {
      "id": "n2",
      "node_type": "output",
      "label": "Result",
      "config": { "output_label": "Final" },
      "inputs": [{ "id": "value", "name": "Value", "kind": "input", "data_type": "any", "multi": true, "required": false, "description": "" }]
    }
  ],
  "edges": [
    { "id": "e1", "source_node_id": "n1", "source_port_id": "output", "target_node_id": "n2", "target_port_id": "value" }
  ]
}
```

---

## ⚙️ Code Nodes

Code nodes run a `run(inputs: dict) -> dict` function. Python and JavaScript are supported.

```python
def run(inputs):
    text = inputs.get("text", "")
    return {"word_count": len(text.split()), "upper": text.upper()}
```

The AI can generate this function for you: just describe what the node should do.

---

## 🤖 AI Providers

| Provider | Model | Env var needed |
|---|---|---|
| **Ollama** (default) | llama3, mistral, … | `OLLAMA_BASE_URL` (default: localhost) |
| OpenAI | gpt-4o, gpt-4-turbo, … | `OPENAI_API_KEY` |
| Anthropic | claude-3-5-sonnet, … | `ANTHROPIC_API_KEY` |
| OpenAI-compatible endpoint | Any compatible model | `OPENAI_COMPATIBLE_BASE_URL`, optional `OPENAI_COMPATIBLE_API_KEY` |

Set environment variables in a `.env` file or pass them to Docker Compose.

---

## 🖥️ Graph Runner CLI

Run any graph JSON from the command line:

```bash
cd graph-runner
python run.py ../examples/hello_world.json
python run.py ../examples/text_transform.json
```

Override text input nodes:
```bash
python run.py my_graph.json --inputs my-text-node-id="Custom input text"
```

---

## 🚢 Deployment

From the frontend toolbar, click **🚀 Deploy** to:

- **Download Bundle** – get a zip containing `graph.json`, `docker-compose.yml`, and `run_graph.py`
- **View Docker Compose** – preview the generated compose file

Or use the API:

```bash
curl -X POST http://localhost:8000/api/deploy/bundle \
  -H "Content-Type: application/json" \
  -d @my_graph.json \
  --output bundle.zip
```

---

## 🧪 Running Tests

```bash
cd backend
pip install -r requirements.txt pytest pytest-asyncio
pytest tests/ -v
```

---

## 📁 Project Structure

```
AI-Graph/
├── backend/              # FastAPI Python backend
│   ├── app/
│   │   ├── main.py       # FastAPI app entry point
│   │   ├── models/       # Graph DSL Pydantic models
│   │   ├── routers/      # API routes (graph, execute, ai, deploy)
│   │   └── services/     # Execution engine, AI, code runner, file ops
│   ├── tests/            # Backend tests
│   └── requirements.txt
├── frontend/             # React + TypeScript + ReactFlow frontend
│   └── src/
│       ├── components/   # UI components (canvas, nodes, editor)
│       ├── store/        # Zustand state management
│       ├── types/        # TypeScript graph types
│       └── utils/        # API client, node defaults
├── graph-runner/         # CLI tool for executing graphs
│   └── run.py
├── examples/             # Example graph JSON files
├── docker-compose.yml    # Full-stack deployment
└── README.md
```
