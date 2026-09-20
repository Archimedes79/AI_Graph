import type { DataType, Port } from '@/graph';
import { DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

/**
 * What a node takes in and hands out, named by the person who wrote it.
 *
 * This was the one thing a graph needed that the editor could not do. A code
 * node was created with `input: any` and `output: any` and there was no way to
 * change either, so every example in this repo had ports the editor could not
 * have produced -- `csv(file_path)`, `kind(text)`, `top(any)` into `figure` and
 * `rows` -- and building one by clicking stopped dead. The ports were only ever
 * written by hand in `graph.json` or by the AI graph generator.
 *
 * Shown only where the ports are the person's to name. An input node's follow
 * from its mode and a gui node's from its blocks, and the element says which it
 * is (`NodeRunner.derivedPorts`), so nothing here switches on a node type.
 *
 * **The id is what the code sees.** A body reads `inputs.csv` and returns
 * `{ figure }`, so the id is the contract with the body, not decoration -- which
 * is why it is the field that is edited, and why renaming one carries its wires
 * (`graphStore.updateNode`).
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
  hint: string;
  kind: 'input' | 'output';
  ports: Port[];
  /** Ports this editor does not own: the Error output the catch-failures switch adds. */
  fixed: Port[];
  onChange: (ports: Port[]) => void;
}

function Side({ title, hint, kind, ports, fixed, onChange }: SideProps) {
  const set = (at: number, patch: Partial<Port>) => {
    onChange(ports.map((port, i) => (i === at ? { ...port, ...patch } : port)));
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs font-medium" style={{ color: MUTED }}>{title}</label>
        <button
          className="text-xs px-2 py-0.5 rounded"
          style={NEUTRAL_BUTTON}
          onClick={() => onChange([...ports, fresh(kind, new Set(ports.map((p) => p.id)))])}
        >
          + {kind}
        </button>
      </div>

      <div className="space-y-1">
        {ports.map((port, at) => (
          <div key={at} className="flex items-center gap-1.5">
            <input
              className="flex-1 min-w-0 rounded px-2 py-1 text-sm font-mono"
              style={FIELD}
              value={port.id}
              // Kept to what a body can read back as `inputs.<id>`: spaces and
              // punctuation would be a port nobody can address in code.
              onChange={(e) => {
                const id = e.target.value.replace(/[^A-Za-z0-9_]/g, '_');
                set(at, { id, name: port.name === port.id ? id : port.name });
              }}
              placeholder="name in the code"
            />
            <select
              className="rounded px-1.5 py-1 text-xs"
              style={FIELD}
              value={port.data_type}
              onChange={(e) => set(at, { data_type: e.target.value as DataType })}
            >
              {TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: DIMMER }} title="A list rather than one value">
              <input type="checkbox" checked={port.multi} onChange={(e) => set(at, { multi: e.target.checked })} />
              list
            </label>
            <button
              className="text-xs px-1.5 py-1 rounded"
              style={NEUTRAL_BUTTON}
              title="Remove this port, and any wire on it"
              onClick={() => onChange(ports.filter((_, i) => i !== at))}
            >
              ✕
            </button>
          </div>
        ))}

        {ports.length === 0 && (
          <p className="text-xs py-1" style={{ color: DIMMER }}>None yet.</p>
        )}

        {fixed.map((port) => (
          <div key={port.id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded" style={{ color: DIMMER, border: `1px dashed ${LINE}` }}>
            <span className="font-mono flex-1">{port.id}</span>
            <span>added by “catch failures”</span>
          </div>
        ))}
      </div>

      <p className="text-xs mt-1" style={{ color: DIMMER }}>{hint}</p>
    </div>
  );
}

interface PortsEditorProps {
  inputs: Port[];
  outputs: Port[];
  onChange: (ports: { inputs: Port[]; outputs: Port[] }) => void;
}

export default function PortsEditor({ inputs, outputs, onChange }: PortsEditorProps) {
  // The Error output belongs to the catch-failures switch, which adds and
  // removes it. Editing it here would let the two disagree.
  const ownOutputs = outputs.filter((port) => port.id !== 'error');
  const fixedOutputs = outputs.filter((port) => port.id === 'error');

  return (
    <div className="space-y-3">
      <Side
        title="Takes in" kind="input" ports={inputs} fixed={[]}
        hint="The body reads these as inputs.<name>. A port set to “File path” is read from disk when “read file contents” is on — and so is one set to “Anything” whose wire comes from a file."
        onChange={(next) => onChange({ inputs: next, outputs })}
      />
      <Side
        title="Hands out" kind="output" ports={ownOutputs} fixed={fixedOutputs}
        hint="The body returns an object with these as its keys: { figure: …, rows: … }."
        onChange={(next) => onChange({ inputs, outputs: [...next, ...fixedOutputs] })}
      />
    </div>
  );
}
