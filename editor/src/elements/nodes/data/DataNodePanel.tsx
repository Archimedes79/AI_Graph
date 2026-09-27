import { useState, type DragEvent } from 'react';
import { errorText } from '@/api/errorText';
import { useTyped } from '@/authoring/useTyped';
import { carriesFiles, droppedFile, type Dropped } from '@/authoring/droppedFile';
import { contentValue } from '@/authoring/readAsRun';
import NodeDefinition from '@/authoring/NodeDefinition';
import { DANGER_SOFT, DIMMER, FIELD, LINE, MUTED, SUNKEN, TEXT } from '@/ui/theme';
import { ONCE, type NodePanelProps } from '../../NodeGuiBuilder';
import { asEditableText, convertedValue, dataKind, storedValue, type DataKind } from './dataFormat';

/**
 * A file dropped on the box: what the node holds from then on, parsed when it
 * is JSON -- an undo step of its own, not more typing into the box. *say* is
 * told why it could not be read, or '' once one was: a failed read used to
 * leave the box as it was, with nothing said.
 */
export async function holdDropped(file: Dropped, setConfig: NodePanelProps['setConfig'], say: (failure: string) => void): Promise<void> {
  try {
    setConfig('data_value', contentValue(await file.text()), ONCE);
    say('');
  } catch (reason) {
    say(`“${file.name}” could not be read -- ${errorText(reason, 'no reason was given')}`);
  }
}

/**
 * A data node: its text, what it holds -- its kind, and the value -- and ✨
 * Data, which writes the value from the text, shaped as the nodes it feeds
 * want it.
 */
export default function DataNodePanel(props: NodePanelProps) {
  return <NodeDefinition {...props} holds={<DataValue node={props.node} setConfig={props.setConfig} />} />;
}

/**
 * What a data node holds, edited in one place: its kind, and the value.
 *
 * What it holds is what it hands on, and what a run replaces with what arrives
 * on its input. A file dropped on the box -- or on the node on the canvas -- is
 * what it holds from then on: what the file says, parsed when it is JSON.
 *
 * What it holds is edited as what it is. The box used to follow only the Kind
 * setting: an object a run had left in a node set to Text was saved back as a
 * string at the first keystroke, a string could not be edited at all under
 * Structure, and valid JSON was re-indented under the caret. Now the value
 * says what it is where it can (`dataKind`), switching the Kind converts it,
 * and what a box holds that does not parse is kept as typed, and not stored.
 */
function DataValue({ node, setConfig }: Pick<NodePanelProps, 'node' | 'setConfig'>) {
  const kind = dataKind(node);
  const held = node.config.data_value;
  const shown = asEditableText(held, kind);
  // The box keeps what is typed; the stored value is what it parses to. What
  // does not parse is not stored -- the box says so, and keeps it as typed.
  const [content, type] = useTyped(shown, (text) => {
    const result = storedValue(text, kind);
    if ('error' in result) return shown;
    setConfig('data_value', result.value);
    return asEditableText(result.value, kind);
  });
  const typed = storedValue(content, kind);
  const contentError = 'error' in typed ? typed.error : '';
  const [dropFailed, setDropFailed] = useState('');

  const switchKind = (next: DataKind) => {
    setConfig('data_format', next);
    // What the box holds but could not store yet is the person's latest word:
    // it is stored under the new kind when it can be. Otherwise the held
    // value is converted.
    const retyped = storedValue(content, next);
    if (!contentError) setConfig('data_value', convertedValue(held, next));
    else if (!('error' in retyped)) setConfig('data_value', retyped.value);
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
    void holdDropped(file, setConfig, setDropFailed);
  };

  return (
    <div className="space-y-1" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium" style={{ color: MUTED }} htmlFor={`${node.id}-held`}>
          What it holds<span className="font-normal" style={{ color: DIMMER }}> — or drop a file here</span>
        </label>
        <select
          className="rounded px-2 py-1 text-xs"
          style={FIELD}
          value={kind}
          onChange={(event) => switchKind(event.target.value as DataKind)}
          aria-label="Kind"
        >
          <option value="text">Text</option>
          <option value="structure">Structure (JSON)</option>
        </select>
      </div>
      <textarea
        id={`${node.id}-held`}
        className="w-full rounded-lg px-3 py-2 text-sm resize-y font-mono"
        style={{ background: SUNKEN, color: TEXT, border: `1px solid ${contentError ? DANGER_SOFT : LINE}`, minHeight: 160 }}
        value={content}
        onChange={(event) => type(event.target.value)}
        spellCheck={false}
        aria-label="What it holds"
      />
      {contentError && <p className="text-xs" style={{ color: DANGER_SOFT }}>{contentError} It is kept once it parses.</p>}
      {dropFailed && <p className="text-xs" style={{ color: DANGER_SOFT }}>{dropFailed}</p>}
      {kind !== node.config.data_format && (
        <p className="text-xs" style={{ color: DIMMER }}>It holds structured data, so it is edited and described as structure.</p>
      )}
      <p className="text-xs" style={{ color: DIMMER }}>
        Kept between runs. What arrives on its input replaces it; until then this is what it hands on,
        and what the nodes wired to it are shown.
      </p>
    </div>
  );
}
