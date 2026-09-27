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
export default function InputPickerWidgetView({ widget, value, onChange, onTrigger }: WidgetViewProps) {
  const isDir = widget.mode === 'directory';
  const listed = Array.isArray(value);
  const hasValue = listed ? value.length > 0 : !!value;

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
      {widget.extensions && !isDir && (
        <span className="text-xs" style={{ color: DIMMER }}>Allowed: {widget.extensions}</span>
      )}
    </div>
  );
}
