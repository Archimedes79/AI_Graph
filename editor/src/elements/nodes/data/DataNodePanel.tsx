import { useEffect } from 'react';
import { useTyped } from '@/authoring/useTyped';
import { DANGER_SOFT, DIMMER, FIELD, LINE, MUTED, SUNKEN, TEXT } from '@/ui/theme';
import type { NodePanelProps } from '../../NodeGuiBuilder';
import { asEditableText, convertedValue, dataKind, storedValue, type DataKind } from './dataFormat';

/**
 * A data node: a value, edited in one place -- its kind, and what it holds.
 *
 * What it holds is what it hands on, what the nodes wired to it are shown as
 * their sample, and what a run replaces with what arrives on its input. There
 * is nothing to write and nothing to generate: a format described beside the
 * value said less than the value, and went stale beside it.
 *
 * What it holds is edited as what it is. The box used to follow only the Kind
 * setting: an object a run had left in a node set to Text was saved back as a
 * string at the first keystroke, a string could not be edited at all under
 * Structure, and valid JSON was re-indented under the caret. Now the value
 * says what it is where it can (`dataKind`), switching the Kind converts it,
 * and a box that does not parse holds up Save rather than being dropped by it.
 */
export default function DataNodePanel({ node, setConfig, setInvalid }: NodePanelProps) {
  const kind = dataKind(node);
  const held = node.config.data_value;
  const shown = asEditableText(held, kind);
  // The box keeps what is typed; the stored value is what it parses to. What
  // does not parse is not stored -- the box says so, and Save waits for it.
  const [content, type] = useTyped(shown, (text) => {
    const result = storedValue(text, kind);
    if ('error' in result) return shown;
    setConfig('data_value', result.value);
    return asEditableText(result.value, kind);
  });
  const typed = storedValue(content, kind);
  const contentError = 'error' in typed ? typed.error : '';

  useEffect(() => setInvalid('held value', contentError), [contentError, setInvalid]);

  const switchKind = (next: DataKind) => {
    setConfig('data_format', next);
    // What the box holds but could not store yet is the person's latest word:
    // it is stored under the new kind when it can be. Otherwise the held
    // value is converted.
    const retyped = storedValue(content, next);
    if (!contentError) setConfig('data_value', convertedValue(held, next));
    else if (!('error' in retyped)) setConfig('data_value', retyped.value);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium" style={{ color: MUTED }} htmlFor={`${node.id}-held`}>What it holds</label>
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
      {contentError && <p className="text-xs" style={{ color: DANGER_SOFT }}>{contentError} It cannot be saved like this.</p>}
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
