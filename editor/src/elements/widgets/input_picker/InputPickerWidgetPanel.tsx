import AuthoredBodyEditor from '@/authoring/AuthoredBodyEditor';
import { FIELD_ON_SURFACE, LINE, MUTED } from '@/ui/theme';
import type { WidgetPanelProps } from '../../WidgetGuiBuilder';

export default function InputPickerWidgetPanel({
  widget, generation, fields, onUpdate, generating, message, onGenerate,
}: WidgetPanelProps) {
  const mode = widget.mode || 'file';

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Mode</label>
        <select
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
          value={mode}
          onChange={(e) => onUpdate({ mode: e.target.value })}
        >
          <option value="file">Single file</option>
          <option value="directory">Directory (list of files)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Default path
        </label>
        <input
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
          value={typeof widget.value === 'string' ? widget.value : ''}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder={mode === 'directory' ? '/path/to/directory' : '/path/to/file'}
        />
      </div>
      {/* Both modes. This sat inside the directory branch, so a picker set to
          one file could not be told which kinds it accepts -- while the block
          itself used the setting either way and the page printed "Allowed: .csv"
          underneath it. The only way to a .csv-only picker was editing the
          graph's JSON by hand, which is how the shipped plotter got one. */}
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          File types (e.g. .md, .txt)
        </label>
        <input
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
          value={widget.extensions ?? ''}
          onChange={(e) => onUpdate({ extensions: e.target.value })}
          placeholder="Leave empty for all file types"
        />
      </div>
      {mode === 'directory' && (
        <>
          <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
            <input
              type="checkbox"
              checked={widget.recursive}
              onChange={(e) => onUpdate({ recursive: e.target.checked })}
            />
            Recursive
          </label>

          {/* The same selector an input node in directory mode authors, drawn by
              the same component -- it is one behaviour at two levels. */}
          <div className="pt-2 space-y-2" style={{ borderTop: `1px solid ${LINE}` }}>
            <AuthoredBodyEditor
              generation={generation}
              fields={fields}
              exampleFile={widget.example_file ?? ''}
              onExampleFileChange={(path) => onUpdate({ example_file: path })}
              generating={generating}
              message={message}
              onGenerate={onGenerate}
              onSurface
              bodyHidden={widget.select_all_files}
            >
              <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
                <input
                  type="checkbox"
                  checked={widget.select_all_files}
                  onChange={(e) => onUpdate({ select_all_files: e.target.checked })}
                />
                Select all files
              </label>
            </AuthoredBodyEditor>
          </div>
        </>
      )}
    </div>
  );
}
