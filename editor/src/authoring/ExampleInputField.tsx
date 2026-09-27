import React, { useRef, useState } from 'react';
import FileBrowserDialog from '@/dialogs/FileBrowserDialog';
import { errorText } from '@/api/errorText';
import CodeField from './CodeField';
import { asExampleText, exampleObject } from './examplePair';
import { contentValue, readFileAsRun, storedPath } from './readAsRun';
import { carriesFiles, droppedFile, droppedValue } from './droppedFile';
import { useTyped } from './useTyped';
import { DANGER_TEXT, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

/**
 * What a picked file puts on *port*: its path where the node reads the file
 * there -- the example then holds what a run hands the node, and it is read
 * exactly as a run reads it, every time -- and otherwise the file's content,
 * parsed when it is JSON.
 */
export async function pickedValue(path: string, port: string, reads: string[]): Promise<unknown> {
  if (reads.includes(port)) return storedPath(path);
  return contentValue(await readFileAsRun(path));
}

/** The example text with *port* set to *value*. */
export function withPortValue(text: string, port: string, value: unknown): string {
  // A file picked into an example that is empty or does not parse yet starts it afresh.
  return asExampleText({ ...exampleObject(text), [port]: value });
}

/**
 * Why *text* cannot be the example yet, or '': it must be an object keyed by
 * input port, or nothing at all.
 */
export function exampleProblem(text: string): string {
  return text.trim() && !exampleObject(text)
    ? 'Not an object keyed by input port yet, like {"input": "…"}: it is kept once it is.'
    : '';
}

interface Props {
  /** The example as stored: a JSON object keyed by input port. */
  text: string;
  /**
   * Stores the example as typed or filled, and says what it reads back as (see
   * `useTyped`). Handed only what can be stored (`exampleProblem`): the box
   * keeps the rest as typed, and says why.
   */
  onText: (text: string) => string;
  /** The ports a file can be picked for. */
  ports: { id: string; name?: string }[];
  /** The ports the node reads the file on (`readFilePorts`): a file picked for one is kept as its path. */
  reads: string[];
  /** ⟳ From the graph: what really arrives here, and a word on where it came from. */
  fromGraph?: () => Promise<{ values: Record<string, unknown>; said: string }>;
  /** One line under the field. */
  note?: React.ReactNode;
}

/**
 * Step 1's example input: one set of values, keyed by input port, that the
 * node is tried on, written against, and tested with.
 *
 * Two ways to fill it, and typing is editing what they filled. What really
 * arrives -- the last run's values, or what the graph delivers when what feeds
 * the node is run. Or a file, picked or dropped on the field (`droppedFile`).
 * There used to be six places a sample came from,
 * and each consumer read a different few of them; the 📎 among them was an
 * uploaded copy that was only ever pasted into ✨'s prompt, never run.
 */
export default function ExampleInputField({ text, onText, ports, reads, fromGraph, note }: Props) {
  // What does not parse is not stored: the graph keeps the last example that
  // did, and the box keeps what was typed.
  const [typed, type] = useTyped(text, (next) => (exampleProblem(next) ? text : onText(next)));
  const error = exampleProblem(typed);
  // What the box holds now, for a file read that ends after more was typed:
  // the file's value is put into that, not into the box as it was clicked.
  const latest = useRef(typed);
  latest.current = typed;
  const [busy, setBusy] = useState<'' | 'graph' | 'file'>('');
  const [said, setSaid] = useState('');
  const [failure, setFailure] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [port, setPort] = useState(ports[0]?.id ?? '');
  const into = ports.some((candidate) => candidate.id === port) ? port : ports[0]?.id ?? '';

  const fetch = async () => {
    if (!fromGraph) return;
    setBusy('graph'); setFailure(''); setSaid('');
    try {
      const got = await fromGraph();
      if (Object.keys(got.values).length) type(asExampleText(got.values));
      setSaid(got.said);
    } catch (reason) {
      setFailure(errorText(reason, 'The graph could not be run up to here.'));
    } finally {
      setBusy('');
    }
  };

  /** Puts what a file gives -- picked with 📂, or dropped -- into the example, on the input chosen for it. */
  const take = async (value: (port: string) => Promise<unknown>): Promise<void> => {
    if (!into) return;
    setBusy('file'); setFailure(''); setSaid('');
    try {
      type(withPortValue(latest.current, into, await value(into)));
      setSaid(reads.includes(into)
        ? `“${into}” holds the file's path, which is read as a run reads it.`
        : `“${into}” holds what the file says.`);
    } catch (reason) {
      setFailure(errorText(reason, 'The file could not be read.'));
    } finally {
      setBusy('');
    }
  };

  // A file dropped on the field is taken as 📂 takes one, with no dialog.
  const onDragOver = (event: React.DragEvent) => {
    if (!into || !carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event: React.DragEvent) => {
    const file = into ? droppedFile(event.dataTransfer) : undefined;
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void take((port) => droppedValue(file, reads.includes(port)));
  };

  return (
    <div className="space-y-1.5" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium" style={{ color: MUTED, flex: '1 1 8rem' }}>
          Example input{ports.length > 0 && <span className="font-normal" style={{ color: DIMMER }}> — or drop a file here</span>}
        </label>
        {fromGraph && (
          <button className="text-xs px-2 py-1 rounded" style={{ ...NEUTRAL_BUTTON, opacity: busy ? 0.5 : 1 }}
            disabled={busy !== ''} onClick={fetch}
            title="What really arrives here: the last run's values, or -- before any run -- what the nodes that feed this one deliver when they are run now">
            {busy === 'graph' ? 'Running upstream…' : '⟳ From the graph'}
          </button>
        )}
        {ports.length > 0 && (
          <>
            {ports.length > 1 && (
              <select className="rounded px-1.5 py-1 text-xs" style={FIELD} value={into}
                onChange={(event) => setPort(event.target.value)} aria-label="Input a file is picked for">
                {ports.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.id}</option>)}
              </select>
            )}
            <button className="text-xs px-2 py-1 rounded" style={{ ...NEUTRAL_BUTTON, opacity: busy ? 0.5 : 1 }}
              disabled={busy !== ''} onClick={() => setBrowsing(true)}
              title={reads.includes(into)
                ? 'Pick a file: its path goes into the example, as a run hands it on -- and is read the way a run reads it'
                : 'Pick a file: what it says goes into the example -- parsed, when it is JSON'}>
              {busy === 'file' ? 'Reading…' : '📂 From a file…'}
            </button>
          </>
        )}
      </div>
      <CodeField
        value={typed}
        onChange={type}
        language="javascript"
        placeholder={`{ ${(ports.length ? ports : [{ id: 'input' }]).map((candidate) => `"${candidate.id}": …`).join(', ')} }`}
        minHeight={72}
        title="Example input"
      />

      {error && <p className="text-xs" style={{ color: DANGER_TEXT }}>{error}</p>}
      {failure && <p className="text-xs" style={{ color: DANGER_TEXT }}>{failure}</p>}
      {said && !failure && <p className="text-xs" style={{ color: DIMMER }}>{said}</p>}
      {note}
      {browsing && (
        <FileBrowserDialog
          mode="file"
          onPick={(path) => { setBrowsing(false); void take((port) => pickedValue(path, port, reads)); }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}
