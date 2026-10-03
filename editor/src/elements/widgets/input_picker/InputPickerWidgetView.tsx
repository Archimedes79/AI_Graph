import type { WidgetViewProps } from '../WidgetView';
import { asText } from '@engine/elements/widgets/text_io/text.ts';
import PathField from '@/dialogs/PathField';
import { DANGER_SOFT, DIMMER, LINE, MUTED } from '@/ui/theme';

/**
 * Runtime input_picker widget: unified file or directory picker.
 *
 * 📂 Browse… browses the machine the graph runs on. A native
 * `<input type="file">` used to be wired up here, but a browser only ever
 * exposes a chosen file's name, never its location -- so it could not produce
 * a path the engine resolves.
 */
export default function InputPickerWidgetView({ widget, value, onChange, onTrigger, fires, busy }: WidgetViewProps) {
  const isDir = widget.mode === 'directory';
  const listed = Array.isArray(value);
  const hasValue = listed ? value.length > 0 : !!value;
  // Filled in already, it starts the graph only when chosen -- which a person
  // looking at a path that is there does not think of doing again: said.
  const startsWith = hasValue && !listed && !!onTrigger && fires === true
    ? `Press Enter to use this ${isDir ? 'folder' : 'file'}`
    : '';

  return (
    <div className="flex flex-col gap-2 h-full">
      <PathField
        value={listed ? '' : asText(value)}
        onChange={onChange}
        mode={isDir ? 'directory' : 'file'}
        extensions={widget.extensions || ''}
        placeholder={isDir ? '/path/to/directory' : '/path/to/file'}
        compact
        mono
        readOnly={listed}
        // A picker that starts the graph waits for the round in flight, as a
        // button does: a file picked meanwhile was kept, and started nothing.
        disabled={busy === true && fires === true}
        // Typing a path is not choosing one until it is finished: Enter says so.
        onKeyDown={(e) => { if (e.key === 'Enter') onTrigger?.(e.currentTarget.value); }}
        // Picking one is.
        onPicked={(picked) => onTrigger?.(picked)}
      >
        {hasValue && (
          <button
            onClick={() => onChange('')}
            className="text-xs px-2 py-1.5 rounded-lg flex-shrink-0"
            style={{ background: LINE, color: DANGER_SOFT }}
            title="Clear selection"
            aria-label={`Clear ${widget.label || widget.id}`}
          >
            ✕
          </button>
        )}
      </PathField>
      {listed && (
        <span className="text-xs" style={{ color: MUTED }}>{`${value.length} file(s) selected`}</span>
      )}
      {((widget.extensions && !isDir) || startsWith) && (
        <span className="text-xs" style={{ color: DIMMER }}>
          {[widget.extensions && !isDir ? `Allowed: ${widget.extensions}` : '', startsWith].filter(Boolean).join(' · ')}
        </span>
      )}
    </div>
  );
}
