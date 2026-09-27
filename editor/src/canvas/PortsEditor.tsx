import type { DataType, Port } from '@/graph';
import { ONCE, type PortEditing, type UndoStep } from '@/elements/NodeGuiBuilder';
import { useTyped } from '@/authoring/useTyped';
import { wholeList } from '@/authoring/perItem';
import { caughtErrorAt, portIdProblems } from './portIds';
import { DANGER_TEXT, DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

/**
 * What a node takes in and hands out, named by the person who wrote it.
 *
 * This was the one thing a graph needed that the editor could not do. A code
 * node was created with `input: any` and `output: any` and there was no way to
 * change either, so every example in this repo had ports the editor could not
 * have produced -- `csv(file_path)`, `kind(text)`, `top(any)` into `figure` and
 * `rows` -- and building one by clicking stopped dead. The ports were only ever
 * written by hand in a node's `interface.json` or by the AI graph generator.
 *
 * Shown only where the ports are the person's to name. An input node's follow
 * from its mode and a gui node's from its blocks, and the element says which it
 * is (`NodeRunner.derivedPorts`), so nothing here switches on a node type.
 *
 * **The id is what the code sees.** A body reads `inputs.csv` and returns
 * `{ figure }`, so the id is the contract with the body, not decoration -- which
 * is why it is the field that is edited, and why renaming one carries its wires
 * (`graphStore.updateNode`).
 *
 * What a port carries is not written here for a node that defines itself
 * (`compact`: a code or ai node). An input's is what is wired into it, said on
 * the line under it, and whether its file is read; what each holds is said in
 * its input.js and output.js. A type box per port said it a second time, and a
 * "list" box was half of a setting whose other half was folded away: a list
 * follows "Run once per item", on both sides -- and while the node runs per item, an input can
 * be taken whole instead ("whole list"), a stop-word list beside the words it
 * runs over. Only a node without the steps -- an output node -- still has a
 * type and a "list" per port.
 */

/** Every type a port can carry, with what each one means for the value on the wire. */
const TYPES: { value: DataType; label: string }[] = [
  { value: 'any', label: 'Anything' },
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'json', label: 'JSON' },
  { value: 'list', label: 'List' },
  { value: 'file_path', label: 'File path' },
  { value: 'image', label: 'Image' },
  { value: 'binary', label: 'Binary' },
];

/** A fresh port, named so two in a row do not collide. */
function fresh(kind: 'input' | 'output', taken: Set<string>): Port {
  const stem = kind === 'input' ? 'input' : 'output';
  let id = stem;
  for (let n = 2; taken.has(id); n += 1) id = `${stem}${n}`;
  return { id, name: id, kind, data_type: 'any', multi: false, required: false, description: '' };
}

interface SideProps {
  title: string;
  hint?: string;
  kind: 'input' | 'output';
  ports: Port[];
  /** Ports this editor does not own: the Error output the catch-failures switch adds. */
  fixed: Port[];
  editing: PortEditing;
  /** What each port is wired to, by port id, in words: `"Folder" (port "Files")`. */
  wiring: Record<string, string>;
  /** Offer "Read the file at this path" on each input: the node is handed the file's text there. */
  readsFiles: boolean;
  /** Offer a type and "list" on each port: see `PortsEditor.compact`. */
  perPort: boolean;
  /** The node runs once per item: see `PortsEditor.perItem`. */
  perItem: boolean;
  /** Why this side could not keep *ports* as they are named, or '' (`portIdProblems`). */
  problemOf: (ports: Port[]) => string;
  /** A name typed is typing; a box ticked, a port added or removed, a step of its own (`ONCE`). */
  onChange: (ports: Port[], step?: UndoStep) => void;
}

/** A name as a body can read it back, `inputs.<id>`: spaces and punctuation would be a port nobody can address in code. */
const codeName = (text: string): string => text.replace(/[^A-Za-z0-9_]/g, '_');

interface RowProps {
  port: Port;
  kind: 'input' | 'output';
  editable: boolean;
  perPort: boolean;
  readsFiles: boolean;
  /**
   * Offer "whole list": the node runs once per item, and another input is
   * fanned out -- the last one taken whole would be no run per item at all.
   */
  wholeOffered: boolean;
  /** What it is wired to, in words, or ''. */
  wired: string;
  /** Why the node could not keep this port under *id*, or ''. */
  problemIf: (id: string) => string;
  set: (patch: Partial<Port>, step?: UndoStep) => void;
  remove: () => void;
}

/**
 * One port. Its name is stored once it is one the node can keep -- a name,
 * not another port's, not the error port's -- and until then shown as typed,
 * with why not: with no Save to wait for, a name typed through "" or through
 * another port's name on its way must not be what the graph holds meanwhile.
 */
function PortRow({ port, kind, editable, perPort, readsFiles, wholeOffered, wired, problemIf, set, remove }: RowProps) {
  const [typed, type] = useTyped(port.id, (text) => {
    const id = codeName(text);
    if (problemIf(id)) return port.id;
    set({ id, name: port.name === port.id ? id : port.name });
    return id;
  });
  const shown = codeName(typed);
  const problem = shown === port.id ? '' : problemIf(shown);

  return (
    <div className="space-y-1" aria-label={`${kind} ${port.id}`}>
      <div className="flex items-center gap-1.5">
        {editable ? (
          <input
            className="flex-1 min-w-0 rounded px-2 py-1 text-sm font-mono"
            style={FIELD}
            value={shown}
            aria-label={`${kind} name`}
            onChange={(e) => type(e.target.value)}
            placeholder="name in the code"
          />
        ) : (
          <span className="flex-1 min-w-0 px-2 py-1 text-sm font-mono" style={{ color: MUTED }}
            title="Read by this name: it cannot be renamed">
            {port.id}
          </span>
        )}
        {editable && (
          <>
            {perPort && (
              <>
                <select
                  className="rounded px-1.5 py-1 text-xs"
                  style={FIELD}
                  value={port.data_type}
                  aria-label={`${kind} type`}
                  onChange={(e) => set({ data_type: e.target.value as DataType }, ONCE)}
                >
                  {TYPES.map((one) => <option key={one.value} value={one.value}>{one.label}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: DIMMER }}
                  title={kind === 'input' ? 'Arrives as a list -- several values, or one per wired node' : 'Hands on a list: the next node runs once per item unless it takes the whole list'}>
                  <input type="checkbox" checked={port.multi} onChange={(e) => set({ multi: e.target.checked }, ONCE)} />
                  list
                </label>
              </>
            )}
            {/* The run reads it on inputs only (`nothingToDo`): a chat's
                model must not be asked with the history alone because
                nobody typed a message. */}
            {kind === 'input' && (
              <label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: DIMMER }}
                title="Needed: when it is wired and nothing arrives on it, this node does not run that round">
                <input type="checkbox" checked={port.required} aria-label="input needed"
                  onChange={(e) => set({ required: e.target.checked }, ONCE)} />
                needed
              </label>
            )}
            {/* The one way a file is read: said here, per input, and kept as
                the port's type. A wire from something that hands on paths
                ticks it where nobody has said anything yet (`connect`). */}
            {kind === 'input' && readsFiles && (
              <label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: DIMMER }}
                title="The node is handed what the file says, not its path -- on every run, in Try it and when ✨ tries its code">
                <input type="checkbox" checked={port.data_type === 'file_path'} aria-label="Read the file at this path"
                  onChange={(e) => set({ data_type: e.target.checked ? 'file_path' : 'any' }, ONCE)} />
                Read the file at this path
              </label>
            )}
            {/* What a run per item hands on whole, beside the list it runs over. */}
            {kind === 'input' && wholeOffered && (
              <label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: DIMMER }}
                title="Handed whole to every run of an item -- a stop-word list beside the words the node runs over -- instead of one item at a time">
                <input type="checkbox" checked={!port.multi} aria-label="whole list"
                  onChange={(e) => set(wholeList(port, e.target.checked), ONCE)} />
                whole list
              </label>
            )}
            <button
              className="text-xs px-1.5 py-1 rounded"
              style={NEUTRAL_BUTTON}
              title="Remove this port, and any wire on it"
              aria-label={`Remove ${kind} ${port.id}`}
              onClick={remove}
            >
              ✕
            </button>
          </>
        )}
      </div>
      {problem && <p className="text-xs pl-1" style={{ color: DANGER_TEXT }}>{problem} It is kept as it was until the name is one it can keep.</p>}
      {/* What the node's kind says about the port when it makes it --
          "What to ask. A list asks once per item." -- and ✨ is told. */}
      {port.description?.trim() && (
        <p className="text-xs pl-1" style={{ color: DIMMER }}>{port.description.trim()}</p>
      )}
      <p className="text-xs pl-1" style={{ color: DIMMER }}>
        {wired
          ? (kind === 'input' ? `← from ${wired}` : `→ to ${wired}`)
          : (kind === 'input' ? '← not wired yet: drag a wire onto it on the canvas' : '→ not wired yet')}
      </p>
    </div>
  );
}

function Side({ title, hint, kind, ports, fixed, editing, wiring, readsFiles, perPort, perItem, problemOf, onChange }: SideProps) {
  const set = (at: number, patch: Partial<Port>, step?: UndoStep) => {
    onChange(ports.map((port, i) => (i === at ? { ...port, ...patch } : port)), step);
  };
  const editable = editing === 'edit';
  // Said of what the graph holds: a file written by hand can hold two ports of one name.
  const problem = editable ? problemOf(ports) : '';

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs font-medium" style={{ color: MUTED }}>{title}</label>
        {editable && (
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded"
            style={NEUTRAL_BUTTON}
            onClick={() => onChange([...ports, fresh(kind, new Set(ports.map((p) => p.id)))], ONCE)}
            title={`Add an ${kind}: name it, and wire it on the canvas`}
          >
            + {kind}
          </button>
        )}
      </div>
      {hint && <p className="text-xs mb-1.5" style={{ color: DIMMER }}>{hint}</p>}

      <div className="space-y-2">
        {ports.map((port, at) => (
          <PortRow
            key={at}
            port={port}
            kind={kind}
            editable={editable}
            perPort={perPort}
            readsFiles={readsFiles}
            wholeOffered={perItem && ports.some((other, i) => i !== at && other.multi)}
            wired={wiring[port.id] ?? ''}
            problemIf={(id) => problemOf(ports.map((candidate, i) => (i === at ? { ...candidate, id } : candidate)))}
            set={(patch, step) => set(at, patch, step)}
            remove={() => onChange(ports.filter((_, i) => i !== at), ONCE)}
          />
        ))}

        {ports.length === 0 && (
          <p className="text-xs py-1" style={{ color: DIMMER }}>None yet.</p>
        )}

        {problem && <p className="text-xs" style={{ color: DANGER_TEXT }}>{problem}</p>}

        {fixed.map((port) => (
          <div key={port.id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded" style={{ color: DIMMER, border: `1px dashed ${LINE}` }}>
            <span className="font-mono flex-1">{port.id}</span>
            <span>added by “catch failures”</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface PortsEditorProps {
  inputs: Port[];
  outputs: Port[];
  onChange: (ports: { inputs: Port[]; outputs: Port[] }, step?: UndoStep) => void;
  /** How much of each side is the person's to change: the element says (`NodeGuiBuilder.portEditing`). */
  editing?: { inputs: PortEditing; outputs: PortEditing };
  /** One line under each side's title, from the element. */
  hints?: { inputs?: string; outputs?: string };
  /** What each port is wired to, by port id. */
  wiring?: { inputs: Record<string, string>; outputs: Record<string, string> };
  /** Offer "Read the file at this path" on each input: the node's kind reads its files (`readsFileInputs`). */
  readsFiles?: boolean;
  /**
   * The node defines itself (`NodeGuiBuilder.definesItself`): no type and no
   * "list" per port. A list follows "Run once per item", which sets it
   * together with what it does nothing without, on both sides.
   */
  compact?: boolean;
  /**
   * The node runs once per item (`runsPerItem`): an input can be handed its
   * list whole instead ("whole list", `wholeList`), where another fans out.
   */
  perItem?: boolean;
  /** Whether the node catches its failures, so that its last "error" output is the one that switch added. */
  caught?: boolean;
}

const EDIT_BOTH = { inputs: 'edit', outputs: 'edit' } as const;
const NO_WIRES = { inputs: {}, outputs: {} };

export default function PortsEditor({
  inputs, outputs, onChange, editing = EDIT_BOTH, hints = {}, wiring = NO_WIRES, readsFiles = false, compact = false,
  perItem = false, caught = false,
}: PortsEditorProps) {
  // The Error output belongs to the catch-failures switch, which adds and
  // removes it. Editing it here would let the two disagree.
  const errorAt = caughtErrorAt(outputs, caught);
  const ownOutputs = outputs.filter((_, at) => at !== errorAt);
  const fixedOutputs = outputs.filter((_, at) => at === errorAt);
  const showInputs = editing.inputs !== 'none';
  const showOutputs = editing.outputs !== 'none';

  return (
    <div className="space-y-3">
      {showInputs && (
        <Side
          title="Takes in" kind="input" ports={inputs} fixed={[]} editing={editing.inputs}
          hint={hints.inputs} wiring={wiring.inputs} readsFiles={readsFiles} perPort={!compact} perItem={perItem}
          problemOf={(next) => portIdProblems(next, outputs, caught).inputs}
          onChange={(next, step) => onChange({ inputs: next, outputs }, step)}
        />
      )}
      {showOutputs && (
        <Side
          title="Hands out" kind="output" ports={ownOutputs} fixed={fixedOutputs} editing={editing.outputs}
          hint={hints.outputs} wiring={wiring.outputs} readsFiles={false} perPort={!compact} perItem={false}
          problemOf={(next) => portIdProblems(inputs, [...next, ...fixedOutputs], caught).outputs}
          onChange={(next, step) => onChange({ inputs, outputs: [...next, ...fixedOutputs] }, step)}
        />
      )}
    </div>
  );
}
