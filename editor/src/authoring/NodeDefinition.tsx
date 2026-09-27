import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { AICall } from '@/api/client';
import { errorText } from '@/api/errorText';
import type { GraphNode } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import FileBrowserDialog from '@/dialogs/FileBrowserDialog';
import { ONCE, type NodePanelProps } from '@/elements/NodeGuiBuilder';
import { STANDARD_PROMPTS, VARIABLES, type PromptKind } from '@engine/authoring/prompts.ts';
import { headingFromText, isNumberedHeading } from '@/document/heading';
import { bodyOf, hasDefinitions, isWritten, writeName, type Write } from './generation';
import { filesOf } from '@/document/givenFiles';
import FileChip from './FileChip';
import GenerationTranscript, { SentPart, useLiveGeneration } from './GenerationTranscript';
import LiveGeneration from './LiveGeneration';
import TryExample, { useTryExample, whatCameOf } from './TryExample';
import { carriesFiles, droppedFile, droppedPath } from './droppedFile';
import { fileValue } from './readAsRun';
import { ACCENT_FILL, ACCENT_TEXT, DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON, SUCCESS, TEXT } from '@/ui/theme';

/** The file a node keeps what *write*'s ✨ writes in. */
function fileOf(node: GraphNode, write: Write): string {
  if (write === 'input') return 'input.js';
  if (write === 'output') return 'output.js';
  const kind = bodyOf(node)?.kind;
  if (kind === 'prompt') return 'prompt.md';
  if (kind === 'data') return node.config.data_format === 'structure' ? 'data.json' : 'data.txt';
  return 'code.js';
}

/** The standard prompt a ✨ is written with, where the node keeps no prompt of its own for it. */
function kindOf(node: GraphNode, write: Write): PromptKind {
  return write === 'body' ? bodyOf(node)?.kind ?? 'code' : write;
}

/** What a prompt may name, each with what it is filled with: in sight while a prompt is worked on. */
function VariableList() {
  return (
    <dl className="text-xs grid gap-x-2 gap-y-0.5" style={{ gridTemplateColumns: 'max-content 1fr' }} aria-label="Variables a prompt may name">
      {Object.entries(VARIABLES).map(([name, meaning]) => (
        <div key={name} className="contents">
          <dt><code style={{ color: MUTED }}>{`{${name}}`}</code></dt>
          <dd style={{ color: DIMMER }}>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A ✨'s prompt, always in sight: the node's own where someone changed it, the
 * standard otherwise -- compact until it is worked on, and then with the
 * variables it may name under it. Reset takes it back to the standard; "What
 * ✨ sends" shows it filled in, as the model will read it.
 */
function PromptBox({ node, write, setConfig, preview }: {
  node: GraphNode; write: Write; setConfig: NodePanelProps['setConfig']; preview?: (write: Write) => Promise<AICall[]>;
}) {
  const standard = STANDARD_PROMPTS[kindOf(node, write)];
  const own = (node.config.prompts as Partial<Record<Write, string>> | undefined)?.[write];
  const [focused, setFocused] = useState(false);
  const [sends, setSends] = useState<AICall[] | null>(null);
  const [note, setNote] = useState('');

  /** The node keeps a prompt only where it differs from the standard: back to it, the key goes. */
  const keep = (text: string | undefined) => setConfig('prompts', (current: unknown) => {
    const next = { ...(current as Record<string, string> | undefined) };
    if (text === undefined || text === standard) delete next[write];
    else next[write] = text;
    return Object.keys(next).length ? next : undefined;
  }, text === undefined ? ONCE : { field: `prompts.${write}` });

  const toggle = async () => {
    if (sends) { setSends(null); return; }
    if (!preview) return;
    setNote('Building the request…');
    try {
      setSends(await preview(write));
      setNote('');
    } catch (error) {
      setNote(errorText(error, 'Could not build the request.'));
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ color: DIMMER }}>{own !== undefined ? 'Its prompt, changed' : 'The standard prompt'}</span>
        {own !== undefined && (
          <button type="button" className="text-xs px-1.5 rounded" style={NEUTRAL_BUTTON} onClick={() => keep(undefined)}
            title="Back to the standard prompt">
            Reset
          </button>
        )}
        {preview && (
          <button type="button" className="text-xs px-1.5 rounded" style={NEUTRAL_BUTTON} onClick={() => void toggle()}
            title="Show what ✨ would send -- this prompt filled in, and the frame after it -- without sending it">
            {sends ? 'Hide what ✨ sends' : 'What ✨ sends'}
          </button>
        )}
      </div>
      <textarea
        className="w-full rounded px-2 py-1 text-xs font-mono resize-y"
        style={{ ...FIELD, minHeight: focused ? 180 : 52 }}
        value={own ?? standard}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => keep(event.target.value)}
        spellCheck={false}
        aria-label={`${writeName(node, write)} prompt`}
      />
      {focused && <VariableList />}
      {note && <p className="text-xs" style={{ color: MUTED }}>{note}</p>}
      {sends?.[0] && (
        <div className="space-y-1" aria-label="What ✨ sends">
          <SentPart label="System" text={sends[0].system} />
          <SentPart label="Prompt" text={sends[0].prompt} />
        </div>
      )}
    </div>
  );
}

/**
 * The files a ✨ writes its definition from -- examples, a spec -- a chip
 * each, ✕ to let one go. 📂 adds one, and so does a file dropped here; for
 * ✨ Input ⟳ adds the one the graph hands the node. With none of its own,
 * ✨ Input reads that one, where there is one.
 */
function FilesLine({ node, side, setConfig, graphFile }: {
  node: GraphNode; side: 'input' | 'output'; setConfig: NodePanelProps['setConfig']; graphFile?: () => Promise<string | undefined>;
}) {
  const key = side === 'input' ? 'input_files' : 'output_files';
  const files = filesOf(node, side);
  const [note, setNote] = useState('');
  const [browsing, setBrowsing] = useState(false);
  /** The files as the node holds them when a change lands. */
  const held = (current: unknown): string[] => (Array.isArray(current) ? current.filter((item): item is string => typeof item === 'string') : []);
  /** One more: a file given twice is still one. */
  const add = (path: string) => setConfig(key, (current: unknown) => (held(current).includes(path) ? held(current) : [...held(current), path]), ONCE);
  const letGo = (path: string) => setConfig(key, (current: unknown) => {
    const left = held(current).filter((item) => item !== path);
    return left.length ? left : undefined;
  }, ONCE);
  const take = async (found: () => Promise<string>) => {
    try {
      add(String(await fileValue(true, found, async () => '')));
      setNote('');
    } catch (error) {
      setNote(errorText(error, 'The file could not be taken.'));
    }
  };
  const fromGraph = async () => {
    const found = await graphFile?.().catch((error: unknown) => { setNote(errorText(error, 'The graph could not be asked.')); return undefined; });
    if (found) { add(found); setNote(''); } else setNote('The graph hands no file-reading input of this node a file yet: add one with 📂, or drop one here.');
  };
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event: DragEvent) => {
    const file = droppedFile(event.dataTransfer);
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void take(() => droppedPath(file));
  };
  const which = side === 'input' ? '✨ Input' : '✨ Output';
  return (
    <div className="text-xs space-y-1" onDragOver={onDragOver} onDrop={onDrop} aria-label={`Files ${which} writes from`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span style={{ color: MUTED }}>{side === 'input' ? 'Example files:' : 'Output files:'}</span>
        {files.map((path) => (
          <span key={path} className="inline-flex items-center gap-1 pl-1.5 rounded" style={FIELD}>
            <code style={{ color: TEXT }}>{path}</code>
            <button type="button" className="px-1 rounded" onClick={() => letGo(path)} aria-label={`Let ${path} go`}
              title={`${which} no longer reads ${path}`} style={{ color: MUTED }}>
              ✕
            </button>
          </span>
        ))}
        {!files.length && (
          <span style={{ color: DIMMER }}>{side === 'input' ? 'none -- it reads the file the graph hands it, where there is one' : 'none'}</span>
        )}
        {side === 'input' && graphFile && (
          <button type="button" className="px-1.5 rounded" style={NEUTRAL_BUTTON} onClick={() => void fromGraph()}
            title="Add the file the graph hands this node: a picked file, or a path the last run brought">
            ⟳ From the graph
          </button>
        )}
        <button type="button" className="px-1.5 rounded" style={NEUTRAL_BUTTON} onClick={() => setBrowsing(true)}
          title={`Add a file ${which} writes from: ${side === 'input' ? 'an example of what arrives, or a spec' : 'a spec of what should go out, or an example'}`}>
          📂 Add a file…
        </button>
        <span style={{ color: DIMMER }}>-- or drop one here</span>
      </div>
      {note && <p style={{ color: MUTED }}>{note}</p>}
      {browsing && (
        <FileBrowserDialog
          mode="file"
          initialPath={files[files.length - 1]}
          onPick={(picked) => { setBrowsing(false); void take(async () => picked); }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}

/**
 * One of what ✨ writes for a node, as a row: its ✨, the file it writes --
 * a chip that opens it, whether or not it is written yet -- and the prompt it
 * is written with, in sight.
 */
function Row({ node, write, setConfig, onGenerate, generating, preview, before, children }: {
  node: GraphNode;
  write: Write;
  setConfig: NodePanelProps['setConfig'];
  onGenerate: NodePanelProps['onGenerate'];
  generating: boolean;
  preview?: (write: Write) => Promise<AICall[]>;
  before: () => void;
  children?: ReactNode;
}) {
  const file = fileOf(node, write);
  return (
    <section className="space-y-1.5 pt-2" style={{ borderTop: `1px solid ${LINE}` }} aria-label={writeName(node, write)}>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => void onGenerate(write)}
          disabled={generating}
          className="text-xs px-2 py-1 rounded"
          style={{ background: SUCCESS, color: 'white', opacity: generating ? 0.5 : 1 }}
          title={write === 'body' && hasDefinitions(node)
            ? `Write ${file} -- and first what is missing of input.js and output.js`
            : `Write ${file} from the node's text`}
        >
          {writeName(node, write)}
        </button>
        <FileChip nodeId={node.id} file={file} written={isWritten(node, write)} before={before} />
      </div>
      <PromptBox node={node} write={write} setConfig={setConfig} preview={preview} />
      {children}
    </section>
  );
}

/**
 * What a code, an ai or a data node is, in its panel: its kind and id, its
 * text -- what it should do, the one thing a person writes -- and what ✨
 * writes from that, a row each: its input definition, its output definition,
 * its body (code.js, prompt.md, or what a data node holds). Then ▶ Try, and
 * the node's history.md. The heading is the dialog's; the Advanced settings
 * too. *holds* is what a data node holds, drawn after its text.
 *
 * "Say what to change" is the bar under the canvas: when it is asked of this
 * node (`pendingChange`), the body is changed here, as said, with what the
 * last try showed.
 */
export default function NodeDefinition({ builder, node, setConfig, updateNode, setDescription, generating, message, onGenerate, shell, holds }: NodePanelProps & { holds?: ReactNode }) {
  const defined = hasDefinitions(node);
  const graph = shell?.graph ?? (() => ({ metadata: useGraphStore.getState().metadata, nodes: [node], edges: [] }));
  const trying = useTryExample(node, graph);
  const liveCalls = useLiveGeneration();
  // What the dialog still holds goes into the graph before a file is opened, so the file says it.
  const before = () => shell?.flush();

  // "Say what to change", asked of this node from the bar under the canvas.
  const pending = useGraphStore((s) => s.pendingChange);
  const taken = useRef(0);
  useEffect(() => {
    if (!pending || pending.nodeId !== node.id || pending.at === taken.current || generating) return;
    taken.current = pending.at;
    useGraphStore.getState().clearChange();
    void onGenerate('body', { change: pending.text, ...whatCameOf(trying.tried) });
  }, [pending, node.id, generating, onGenerate, trying.tried]);

  /** While its heading is still the numbered one it was given, it is written from the text. */
  const headingFromTheText = () => {
    if (!isNumberedHeading(node.label)) return;
    const heading = headingFromText(node.description);
    if (heading) updateNode((current) => ({ ...current, label: heading }), ONCE);
  };

  const needs = defined && node.inputs.length && !isWritten(node, 'input')
    ? 'Write its input.js first (✨ Input): its example is what it is tried on.' : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="px-1.5 rounded font-semibold" style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}>{builder.label.toUpperCase()}</span>
        <code style={{ color: DIMMER }}>{node.id}</code>
      </div>
      <div>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-y"
          style={{ ...FIELD, minHeight: 72 }}
          value={node.description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={headingFromTheText}
          placeholder={`What should this node do? In your own words -- ✨ writes ${defined ? 'its files' : 'what it holds'} from this.`}
          aria-label="What it should do"
        />
      </div>
      {holds}
      {defined && (
        <Row node={node} write="input" setConfig={setConfig} onGenerate={onGenerate} generating={generating} preview={shell?.preview} before={before}>
          <FilesLine node={node} side="input" setConfig={setConfig} graphFile={shell?.graphFile} />
        </Row>
      )}
      {defined && (
        <Row node={node} write="output" setConfig={setConfig} onGenerate={onGenerate} generating={generating} preview={shell?.preview} before={before}>
          <FilesLine node={node} side="output" setConfig={setConfig} />
        </Row>
      )}
      <Row node={node} write="body" setConfig={setConfig} onGenerate={onGenerate} generating={generating} preview={shell?.preview} before={before} />
      {generating && <LiveGeneration calls={liveCalls} minHeight={80} />}
      {message && (
        <div className="text-xs px-2 py-1.5 rounded" style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}>{message}</div>
      )}
      <GenerationTranscript />
      {defined && (
        <section className="pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
          <TryExample
            tried={trying.tried}
            running={trying.running}
            onTry={() => void trying.start()}
            whyNot={needs}
            busy={generating}
            onFix={() => void onGenerate('body', whatCameOf(trying.tried) ?? {})}
          />
        </section>
      )}
      <div className="flex items-center gap-2 text-xs pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
        <span style={{ color: MUTED }}>Every exchange with the model about it:</span>
        <FileChip nodeId={node.id} file="history.md" written={!!String(node.config.history ?? '').trim()} before={before} />
      </div>
    </div>
  );
}
