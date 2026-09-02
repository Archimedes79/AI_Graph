import React from 'react';
import type { GuiWidget } from '@/types/graph';
import AuthoredBodyEditor from '@/elements/shared/AuthoredBodyEditor';
import type { ElementGeneration, FieldAccess } from '@/elements/shared/generation';
import { FIELD_ON_SURFACE, LINE, MUTED } from '@/ui/theme';

interface InputPickerEditorProps {
  widget: GuiWidget;
  generation: ElementGeneration<GuiWidget>;
  fields: FieldAccess;
  onUpdate: (patch: Partial<GuiWidget>) => void;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
}

export default function InputPickerEditor({
  widget, generation, fields, onUpdate, generating, message, onGenerate,
}: InputPickerEditorProps) {
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
      {mode === 'directory' && (
        <>
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
