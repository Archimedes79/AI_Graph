import React from 'react';
import type { GuiWidget } from '../../../../types/graph';
import ContextFileAttachment from '../../../shared/ContextFileAttachment';
import { ACCENT_TEXT, DIMMER, FIELD_ON_SURFACE, MUTED, SUCCESS } from '../../../../ui/theme';

interface ImageViewEditorProps {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
}

/**
 * image_view has almost nothing to configure: it shows whatever file path is
 * wired into it. The optional transform is the same escape hatch plot_window
 * has, for the case where the incoming value needs reshaping into a path first
 * -- and, since generation is declared by the element rather than switched on
 * in the shell, it now has the ✨ button plot_window always had.
 */
export default function ImageViewEditor({
  widget, onUpdate, generating, message, onGenerate,
}: ImageViewEditorProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: MUTED }}>
        Wire a file path (or a list of them, from a directory picker) into this widget and it
        displays the picture. PNG, JPEG, GIF, WebP, BMP and SVG are recognised.
      </p>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Prompt
        </label>
        <textarea
          className="w-full rounded-lg px-2 py-1.5 text-sm resize-none"
          style={{ ...FIELD_ON_SURFACE, minHeight: 60 }}
          value={widget.code_prompt ?? ''}
          onChange={(e) => onUpdate({ code_prompt: e.target.value })}
          placeholder="Describe how to get an image path out of the incoming value, e.g. take the 'cover' field of each record."
          spellCheck={false}
        />
      </div>

      <ContextFileAttachment
        label="Example input (optional file)"
        path={widget.example_file ?? ''}
        onChange={(path) => onUpdate({ example_file: path })}
      />

      <div className="flex items-center justify-between mb-1">
        <select
          className="rounded-lg px-2 py-1 text-xs"
          style={FIELD_ON_SURFACE}
          value={widget.language ?? 'python'}
          onChange={(e) => onUpdate({ language: e.target.value as 'python' | 'javascript' })}
        >
          <option value="python">Python</option>
          <option value="javascript">JavaScript</option>
        </select>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="text-xs px-2 py-1 rounded"
          style={{ background: SUCCESS, color: 'white', opacity: generating ? 0.5 : 1 }}
        >
          {generating ? '…' : '✨ Generate'}
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Optional transform — <code>run(inputs)</code> receives {'{'}"value"{'}'} and returns {'{'}"value"{'}'}
        </label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
          style={{ ...FIELD_ON_SURFACE, minHeight: 90 }}
          value={widget.code ?? ''}
          onChange={(e) => onUpdate({ code: e.target.value })}
          placeholder="Leave empty to display the incoming path as-is."
          spellCheck={false}
        />
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Only needed when the incoming value is not already a path — e.g. picking one field out of
          a record.
        </p>
        {message && (
          <div className="text-xs mt-2 px-2 py-1.5 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: ACCENT_TEXT }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
